/**
 * BoardLogic.ts
 * 2048 棋盘核心逻辑，包含能量槽、炸弹方块和 3x3 爆炸机制。
 * 该文件不依赖 Cocos Creator，可独立进行逻辑测试。
 */

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'nightmare';

export interface DifficultyConfig {
    label: string;
    target: number;
    /** 生成普通 4 的概率，剩余概率生成 2。 */
    fourProbability: number;
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
    easy: { label: '简单', target: 1024, fourProbability: 0.10 },
    normal: { label: '中等', target: 2048, fourProbability: 0.10 },
    hard: { label: '困难', target: 4096, fourProbability: 0.05 },
    nightmare: { label: '噩梦', target: 8192, fourProbability: 0.02 },
};

/** 棋盘上的一个方块；id 用于让 UI 在移动和合并时追踪同一个方块。 */
export interface TileData {
    id: number;
    value: number;
    isBomb?: boolean;
}

/** 棋盘坐标。row 从上到下，col 从左到右。 */
export interface Pos {
    row: number;
    col: number;
}

/** 一次移动中，一个目标方块的完整来源记录。 */
export interface TileMove {
    from: Pos[];
    sourceIds: number[];
    sourceBombs: boolean[];
    to: Pos;
    value: number;
    merged: boolean;
    /** 合并后保留的主方块 ID。 */
    resultId: number;
    /** 本次合并是否有炸弹参与。 */
    bombTriggered: boolean;
    /** 合并后的目标是否仍为炸弹；当前规则下合并结果为普通方块。 */
    resultIsBomb: boolean;
}

export interface ExplosionEvent {
    center: Pos;
    value: number;
    targetPositions: Pos[];
    targetIds: number[];
    scoreGained: number;
}

export interface MoveResult {
    moves: TileMove[];
    explosions: ExplosionEvent[];
    combo: number;
    energy: number;
    maxEnergy: number;
    bombNextSpawn: boolean;
}

interface SlideResult {
    out: TileData[];
    sourceIndexes: number[][];
    sourceBombs: boolean[][];
    bombMerges: boolean[];
}

const ENERGY_PER_MERGE = 20;
const MAX_ENERGY = 100;

/** 采用文档允许的九宫格爆炸范围，中心格由 resolveExplosions 保留。 */
const BLAST_OFFSETS: Pos[] = [
    { row: -1, col: -1 }, { row: -1, col: 0 }, { row: -1, col: 1 },
    { row: 0, col: -1 }, { row: 0, col: 0 }, { row: 0, col: 1 },
    { row: 1, col: -1 }, { row: 1, col: 0 }, { row: 1, col: 1 },
];

export class BoardLogic {
    public readonly size: number;
    public readonly difficulty: Difficulty;
    public readonly maxEnergy = MAX_ENERGY;
    public grid: TileData[][];
    public score: number;
    public energy: number;
    /** 能量满或 Combo 达标后，下一次生成的方块会成为炸弹。 */
    public bombNextSpawn: boolean;

    private nextTileId = 1;

    public constructor(size: number = 4, difficulty: Difficulty = 'easy') {
        if (!Number.isInteger(size) || size < 2) {
            throw new Error('棋盘尺寸必须是大于等于 2 的整数');
        }
        if (!DIFFICULTY_CONFIGS[difficulty]) {
            throw new Error(`未知难度：${difficulty}`);
        }
        this.size = size;
        this.difficulty = difficulty;
        this.grid = [];
        this.score = 0;
        this.energy = 0;
        this.bombNextSpawn = false;
        this.reset();
    }

    /** 重置棋盘，并在两个随机空格生成初始方块。 */
    public reset(): void {
        this.grid = Array.from(
            { length: this.size },
            () => Array.from({ length: this.size }, () => this.emptyTile()),
        );
        this.score = 0;
        this.energy = 0;
        this.bombNextSpawn = false;
        this.spawnTile();
        this.spawnTile();
    }

    public emptyCells(): Pos[] {
        const cells: Pos[] = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col].value === 0) cells.push({ row, col });
            }
        }
        return cells;
    }

    /** 在随机空格生成普通 2/4 或待生成的炸弹 2/4。 */
    public spawnTile(): Pos | null {
        const cells = this.emptyCells();
        if (cells.length === 0) return null;

        const pos = cells[Math.floor(Math.random() * cells.length)];
        const isBomb = this.bombNextSpawn;
        this.grid[pos.row][pos.col] = {
            id: this.nextTileId++,
            value: Math.random() < this.config.fourProbability ? 4 : 2,
            isBomb: isBomb || undefined,
        };

        if (isBomb) {
            this.bombNextSpawn = false;
            this.energy = 0;
        }
        return pos;
    }

    /**
     * 移动、合并、充能并处理炸弹爆炸。
     * 无效移动返回空 moves，不生成新方块，也不改变能量和分数。
     */
    public move(direction: Direction): MoveResult {
        const moves: TileMove[] = [];

        if (direction === 'left' || direction === 'right') {
            for (let row = 0; row < this.size; row++) {
                const original = this.grid[row].slice();
                const values = direction === 'left' ? original : original.slice().reverse();
                const result = this.slideLine(values);
                const output = direction === 'left' ? result.out : result.out.slice().reverse();
                this.grid[row] = output;
                this.appendMoves(
                    moves,
                    result,
                    row,
                    direction === 'left',
                    false,
                    values,
                );
            }
        } else {
            for (let col = 0; col < this.size; col++) {
                const original: TileData[] = [];
                for (let row = 0; row < this.size; row++) original.push(this.grid[row][col]);

                const values = direction === 'up' ? original : original.slice().reverse();
                const result = this.slideLine(values);
                const output = direction === 'up' ? result.out : result.out.slice().reverse();
                for (let row = 0; row < this.size; row++) this.grid[row][col] = output[row];
                this.appendMoves(
                    moves,
                    result,
                    col,
                    direction === 'up',
                    true,
                    values,
                );
            }
        }

        const realMoves = moves.filter((move) => {
            if (move.merged) return true;
            const from = move.from[0];
            return from.row !== move.to.row || from.col !== move.to.col;
        });
        const combo = realMoves.reduce((count, move) => count + (move.merged ? 1 : 0), 0);

        if (realMoves.length === 0) {
            return {
                moves: [],
                explosions: [],
                combo: 0,
                energy: this.energy,
                maxEnergy: this.maxEnergy,
                bombNextSpawn: this.bombNextSpawn,
            };
        }

        this.score += realMoves.reduce((total, move) => total + (move.merged ? move.value : 0), 0);
        this.energy = Math.min(this.maxEnergy, this.energy + combo * ENERGY_PER_MERGE);
        if (combo >= 3 || this.energy >= this.maxEnergy) this.bombNextSpawn = true;

        const explosions = this.resolveExplosions(realMoves);
        return {
            moves: realMoves,
            explosions,
            combo,
            energy: this.energy,
            maxEnergy: this.maxEnergy,
            bombNextSpawn: this.bombNextSpawn,
        };
    }

    public hasEmpty(): boolean {
        return this.emptyCells().length > 0;
    }

    public hasAdjacentEqual(): boolean {
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const value = this.grid[row][col].value;
                if (value === 0) continue;
                if (col + 1 < this.size && this.grid[row][col + 1].value === value) return true;
                if (row + 1 < this.size && this.grid[row + 1][col].value === value) return true;
            }
        }
        return false;
    }

    public isGameOver(): boolean {
        return !this.hasEmpty() && !this.hasAdjacentEqual();
    }

    public hasWon(target: number = this.config.target): boolean {
        for (const row of this.grid) {
            for (const tile of row) {
                if (tile.value >= target) return true;
            }
        }
        return false;
    }

    private get config(): DifficultyConfig {
        return DIFFICULTY_CONFIGS[this.difficulty];
    }

    private emptyTile(): TileData {
        return { id: 0, value: 0 };
    }

    private slideLine(line: TileData[]): SlideResult {
        const nonempty = line
            .map((tile, index) => ({ tile, index }))
            .filter((item) => item.tile.value !== 0);
        const out: TileData[] = [];
        const sourceIndexes: number[][] = [];
        const sourceBombs: boolean[][] = [];
        const bombMerges: boolean[] = [];

        let index = 0;
        while (index < nonempty.length) {
            const current = nonempty[index];
            const next = nonempty[index + 1];
            if (next && current.tile.value === next.tile.value) {
                const bombs = [!!current.tile.isBomb, !!next.tile.isBomb];
                current.tile.value *= 2;
                // 炸弹参与合成后，中心新方块为普通方块。
                current.tile.isBomb = undefined;
                out.push(current.tile);
                sourceIndexes.push([current.index, next.index]);
                sourceBombs.push(bombs);
                bombMerges.push(bombs[0] || bombs[1]);
                index += 2;
            } else {
                out.push(current.tile);
                sourceIndexes.push([current.index]);
                sourceBombs.push([!!current.tile.isBomb]);
                bombMerges.push(false);
                index += 1;
            }
        }

        while (out.length < line.length) {
            out.push(this.emptyTile());
            sourceIndexes.push([]);
            sourceBombs.push([]);
            bombMerges.push(false);
        }
        return { out, sourceIndexes, sourceBombs, bombMerges };
    }

    private appendMoves(
        moves: TileMove[],
        result: SlideResult,
        fixedIndex: number,
        forward: boolean,
        isColumn: boolean,
        sourceLine: TileData[],
    ): void {
        for (let targetIndex = 0; targetIndex < result.sourceIndexes.length; targetIndex++) {
            const indexes = result.sourceIndexes[targetIndex];
            if (indexes.length === 0) continue;

            const from = indexes.map((index) => {
                const actualIndex = forward ? index : this.size - 1 - index;
                return isColumn
                    ? { row: actualIndex, col: fixedIndex }
                    : { row: fixedIndex, col: actualIndex };
            });
            const actualTarget = forward ? targetIndex : this.size - 1 - targetIndex;
            const to = isColumn
                ? { row: actualTarget, col: fixedIndex }
                : { row: fixedIndex, col: actualTarget };
            const sourceIds = indexes.map((index) => sourceLine[index].id);
            const sourceBombs = result.sourceBombs[targetIndex];

            moves.push({
                from,
                sourceIds,
                sourceBombs,
                to,
                value: result.out[targetIndex].value,
                merged: indexes.length === 2,
                resultId: sourceIds[0],
                bombTriggered: result.bombMerges[targetIndex],
                resultIsBomb: false,
            });
        }
    }

    private resolveExplosions(moves: TileMove[]): ExplosionEvent[] {
        const explosions: ExplosionEvent[] = [];
        const destroyedIds = new Set<number>();

        for (const move of moves) {
            if (!move.merged || !move.bombTriggered) continue;

            const targetPositions: Pos[] = [];
            const targetIds: number[] = [];
            let scoreGained = 0;
            for (const offset of BLAST_OFFSETS) {
                const row = move.to.row + offset.row;
                const col = move.to.col + offset.col;
                if (row < 0 || row >= this.size || col < 0 || col >= this.size) continue;
                if (row === move.to.row && col === move.to.col) continue;

                const tile = this.grid[row][col];
                if (tile.value === 0 || tile.value > move.value || destroyedIds.has(tile.id)) continue;
                targetPositions.push({ row, col });
                targetIds.push(tile.id);
                scoreGained += tile.value * 2;
                destroyedIds.add(tile.id);
                this.grid[row][col] = this.emptyTile();
            }

            this.score += scoreGained;
            explosions.push({
                center: { row: move.to.row, col: move.to.col },
                value: move.value,
                targetPositions,
                targetIds,
                scoreGained,
            });
        }
        return explosions;
    }
}
