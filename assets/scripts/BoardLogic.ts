/**
 * BoardLogic.ts
 * 2048 棋盘核心逻辑，包含能量槽、炸弹方块和 3x3 爆炸机制。
 * 该文件不依赖 Cocos Creator，可独立进行逻辑测试。
 */

export type Direction = 'up' | 'down' | 'left' | 'right';
export type Difficulty = 'easy' | 'normal' | 'hard' | 'nightmare';

export interface DifficultyConfig {
    label: string;
    /** 每次合并获得的能量值 */
    energyPerMerge: number;
    /** 触发下一个炸弹所需的最小 Combo 数 */
    comboForBomb: number;
    /** 生成方块数值及其概率配置 [{ value: number, prob: number }] */
    spawnWeights: { value: number; prob: number }[];
    /** 分数换算金币比例 (每多少分兑换 1 金币) */
    coinRate: number;
}

export const DIFFICULTY_CONFIGS: Record<Difficulty, DifficultyConfig> = {
    easy: {
        label: '简单',
        energyPerMerge: 30,
        comboForBomb: 2,
        spawnWeights: [{ value: 2, prob: 0.90 }, { value: 4, prob: 0.10 }],
        coinRate: 100,
    },
    normal: {
        label: '中等',
        energyPerMerge: 20,
        comboForBomb: 3,
        spawnWeights: [{ value: 2, prob: 0.93 }, { value: 4, prob: 0.07 }],
        coinRate: 50,
    },
    hard: {
        label: '困难',
        energyPerMerge: 15,
        comboForBomb: 5,
        spawnWeights: [{ value: 2, prob: 0.96 }, { value: 4, prob: 0.035 }, { value: 8, prob: 0.005 }],
        coinRate: 25,
    },
    nightmare: {
        label: '噩梦',
        energyPerMerge: 10,
        comboForBomb: 7,
        spawnWeights: [{ value: 2, prob: 0.98 }, { value: 4, prob: 0.018 }, { value: 8, prob: 0.002 }],
        coinRate: 10,
    },
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

/**
 * 战斗 Buff 配置，由装备称号提供。
 * 未设置的字段使用默认值，不改变现有行为。
 */
export interface BoardBuffs {
    /** 分数加成倍率（SCORE_BONUS），默认 1.0 */
    scoreMultiplier?: number;
    /** 额外炸弹生成概率（BOMB_PROB），默认 0 */
    bombProb?: number;
    /** 爆炸范围扩大格数（BOMB_RANGE），默认 0（3x3 九宫格） */
    bombRangeExtra?: number;
    /** 被炸方块得分倍率（BOMB_SCORE_MULT），默认 1.0 */
    bombScoreMultiplier?: number;
    /** 爆炸不毁方块只加分的概率（BOMB_NO_DESTROY），默认 0 */
    bombNoDestroyProb?: number;

    // === SSR/UR 专属复合机制 ===
    /** 单步移动合并数 ≥3 时，额外奖励金币数（COMBO_GOLD_BONUS），默认 0 */
    comboGoldBonus?: number;
    /** 每次合成时原地掉落金币的概率（MERGE_GOLD_DROP），默认 0 */
    mergeGoldDropProb?: number;
    /** 爆炸后引力吸入全屏最小同值方块合并（GRAVITY_MERGE），默认 false */
    gravityMerge?: boolean;
    /** 每局免费撤销步数（UNDO_COUNT），默认 0 */
    undoCount?: number;
    /** 开局随机两格直升为 16（INITIAL_BOOST），默认 false */
    initialBoost?: boolean;
    /** 波及同值方块时追加十字冲击波（CHAIN_EXPLOSION），默认 false */
    chainExplosion?: boolean;
    /** 爆炸触发连环爆破，清屏所有 ≤N 的方块（CLEAR_SMALL_TILES），默认 0 禁用 */
    clearSmallThreshold?: number;
    /** 空格不足 3 个时暂停生成方块的可用次数（PAUSE_SPAWN），默认 0 */
    pauseSpawnUses?: number;
    /** 空格不足 4 个时激活绝对领域、奇数位同化的可用次数（ABSOLUTE_DOMAIN），默认 0 */
    absoluteDomainUses?: number;
    /** 新方块保底数值（MIN_SPAWN_VALUE），默认 0 不限制 */
    minSpawnValue?: number;
    /** 生成 8 的额外概率（SPAWN_8_PROB），默认 0 */
    spawn8Prob?: number;
    /** 合成出 2048 时返还金币数（WIN_2048_REWARD），默认 0 */
    win2048Reward?: number;
    /** 连击得分额外倍率（COMBO_SCORE_MULT），默认 1.0 */
    comboScoreMultiplier?: number;
    /** 卡死濒死时自动回溯清杂的可用次数（GAME_OVER_PREVENT），默认 0 */
    gameOverPreventUses?: number;
}

/** 引力吸入合并事件（灭世奇点）：两个最小同值方块被吸入合并 */
export interface GravityMergeEvent {
    from: Pos[];
    to: Pos;
    value: number;
}

/** 奇数位同化事件（熵寂主宰） */
export interface AbsoluteDomainEvent {
    positions: Pos[];
    value: number;
}

export interface MoveResult {
    moves: TileMove[];
    explosions: ExplosionEvent[];
    combo: number;
    energy: number;
    maxEnergy: number;
    bombNextSpawn: boolean;

    // === SSR/UR 专属机制的返回值 ===
    /** 连击奖励金币数（黄金点金手），默认 0 */
    comboGoldBonus?: number;
    /** 合成掉落金币总数（无尽财阀），默认 0 */
    goldDrops?: number;
    /** 引力吸入合并（灭世奇点），无则不返回 */
    gravityMerge?: GravityMergeEvent;
    /** 十字冲击波附加爆炸（裂变源点），并入 explosions 渲染，此字段供提示 */
    chainTriggered?: boolean;
    /** 清屏所有 ≤N 的方块（超新星爆裂），无则不返回 */
    smallClearCount?: number;
    /** 合成出 2048 触发的通关返利金币（创世主脑），默认 0 */
    win2048Reward?: number;
    /** 本步是否触发了卡死回溯（因果掌控者） */
    gameOverPrevented?: boolean;
    /** 本步是否暂停生成新方块（绝对零度） */
    pausedSpawn?: boolean;
    /** 本步炸弹是否触发了不摧毁方块效果（幸存者偏差） */
    bombNoDestroyTriggered?: boolean;
    /** 奇数位同化（熵寂主宰），无则不返回 */
    absoluteDomain?: AbsoluteDomainEvent;
    /** 本次移动后棋盘仍可继续的剩余暂停次数（绝对零度），便于 UI 展示 */
    pauseSpawnLeft?: number;
}

/** 生成指定半径的格点偏移（Chebyshev 距离），不含中心(0,0)。 */
function blastOffsets(radius: number): Pos[] {
    const offsets: Pos[] = [];
    for (let row = -radius; row <= radius; row++) {
        for (let col = -radius; col <= radius; col++) {
            if (row === 0 && col === 0) continue;
            offsets.push({ row, col });
        }
    }
    return offsets;
}

export class BoardLogic {
    public readonly size: number;
    public lastSpawnPaused: boolean = false;
    public lastAbsoluteDomain: boolean = false;
    public lastBombProbTriggered: boolean = false;
    public lastSpawn8Triggered: boolean = false;
    public initialBoostTriggered: boolean = false;
    public readonly difficulty: Difficulty;
    public readonly maxEnergy = MAX_ENERGY;
    public grid: TileData[][];
    public score: number;
    public energy: number;
    /** 能量满或 Combo 达标后，下一次生成的方块会成为炸弹。 */
    public bombNextSpawn: boolean;

    public buffs: Required<BoardBuffs>;

    private nextTileId = 1;

    // === SSR/UR 机制的每局状态 ===
    /** 本局剩余撤销次数（时空折叠者） */
    private undoLeft = 0;
    /** 本局剩余暂停生成次数（绝对零度） */
    private pauseSpawnLeft = 0;
    /** 本局剩余绝对领域次数（熵寂主宰） */
    private absoluteDomainLeft = 0;
    /** 本局剩余卡死回溯次数（因果掌控者） */
    private gameOverPreventLeft = 0;
    /** 已合成出 2048 并发放过返利（创世主脑，每局一次） */
    private win2048Rewarded = false;
    /** 撤销用的棋盘快照栈（最近一步在前） */
    private history: { grid: TileData[][]; score: number; energy: number; bombNextSpawn: boolean }[] = [];

    // === 每局次数资源的“累计已用”记账 ===
    // 局中切换称号时 updateBuffs 会按当前称号刷新剩余次数，
    // 这里记录本局已消耗的次数，防止通过反复换装重置次数白嫖。
    /** 本局已用撤销次数（跨称号切换保留） */
    private undoUsed = 0;
    /** 本局已用暂停生成次数（跨称号切换保留） */
    private pauseSpawnUsed = 0;
    /** 本局已用绝对领域次数（跨称号切换保留） */
    private absoluteDomainUsed = 0;
    /** 本局已用卡死回溯次数（跨称号切换保留） */
    private gameOverPreventUsed = 0;

    public constructor(size: number = 4, difficulty: Difficulty = 'easy', buffs: BoardBuffs = {}) {
        if (!Number.isInteger(size) || size < 2) {
            throw new Error('棋盘尺寸必须是大于等于 2 的整数');
        }
        if (!DIFFICULTY_CONFIGS[difficulty]) {
            throw new Error(`未知难度：${difficulty}`);
        }
        this.size = size;
        this.difficulty = difficulty;
        this.buffs = {
            scoreMultiplier: buffs.scoreMultiplier ?? 1.0,
            bombProb: buffs.bombProb ?? 0,
            bombRangeExtra: buffs.bombRangeExtra ?? 0,
            bombScoreMultiplier: buffs.bombScoreMultiplier ?? 1.0,
            bombNoDestroyProb: buffs.bombNoDestroyProb ?? 0,
            comboGoldBonus: buffs.comboGoldBonus ?? 0,
            mergeGoldDropProb: buffs.mergeGoldDropProb ?? 0,
            gravityMerge: buffs.gravityMerge ?? false,
            undoCount: buffs.undoCount ?? 0,
            initialBoost: buffs.initialBoost ?? false,
            chainExplosion: buffs.chainExplosion ?? false,
            clearSmallThreshold: buffs.clearSmallThreshold ?? 0,
            pauseSpawnUses: buffs.pauseSpawnUses ?? 0,
            absoluteDomainUses: buffs.absoluteDomainUses ?? 0,
            minSpawnValue: buffs.minSpawnValue ?? 0,
            spawn8Prob: buffs.spawn8Prob ?? 0,
            win2048Reward: buffs.win2048Reward ?? 0,
            comboScoreMultiplier: buffs.comboScoreMultiplier ?? 1.0,
            gameOverPreventUses: buffs.gameOverPreventUses ?? 0,
        };
        this.grid = [];
        this.score = 0;
        this.energy = 0;
        this.bombNextSpawn = false;
        this.reset();
    }

    public updateBuffs(newBuffs: BoardBuffs): void {
        this.buffs = {
            scoreMultiplier: newBuffs.scoreMultiplier ?? 1.0,
            bombProb: newBuffs.bombProb ?? 0,
            bombRangeExtra: newBuffs.bombRangeExtra ?? 0,
            bombScoreMultiplier: newBuffs.bombScoreMultiplier ?? 1.0,
            bombNoDestroyProb: newBuffs.bombNoDestroyProb ?? 0,
            comboGoldBonus: newBuffs.comboGoldBonus ?? 0,
            mergeGoldDropProb: newBuffs.mergeGoldDropProb ?? 0,
            gravityMerge: newBuffs.gravityMerge ?? false,
            undoCount: newBuffs.undoCount ?? 0,
            initialBoost: newBuffs.initialBoost ?? false,
            chainExplosion: newBuffs.chainExplosion ?? false,
            clearSmallThreshold: newBuffs.clearSmallThreshold ?? 0,
            pauseSpawnUses: newBuffs.pauseSpawnUses ?? 0,
            absoluteDomainUses: newBuffs.absoluteDomainUses ?? 0,
            minSpawnValue: newBuffs.minSpawnValue ?? 0,
            spawn8Prob: newBuffs.spawn8Prob ?? 0,
            win2048Reward: newBuffs.win2048Reward ?? 0,
            comboScoreMultiplier: newBuffs.comboScoreMultiplier ?? 1.0,
            gameOverPreventUses: newBuffs.gameOverPreventUses ?? 0
        };
        
        // Refresh remaining uses based on the new title's buff properties
        // 用“配置上限 - 本局已用”计算剩余，换称号不会把已消耗的次数补回来
        this.undoLeft = Math.max(0, this.buffs.undoCount - this.undoUsed);
        this.pauseSpawnLeft = Math.max(0, this.buffs.pauseSpawnUses - this.pauseSpawnUsed);
        this.absoluteDomainLeft = Math.max(0, this.buffs.absoluteDomainUses - this.absoluteDomainUsed);
        this.gameOverPreventLeft = Math.max(0, this.buffs.gameOverPreventUses - this.gameOverPreventUsed);
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
        this.initialBoostTriggered = false;
        this.undoLeft = this.buffs.undoCount;
        this.pauseSpawnLeft = this.buffs.pauseSpawnUses;
        this.absoluteDomainLeft = this.buffs.absoluteDomainUses;
        this.gameOverPreventLeft = this.buffs.gameOverPreventUses;
        this.win2048Rewarded = false;
        this.undoUsed = 0;
        this.pauseSpawnUsed = 0;
        this.absoluteDomainUsed = 0;
        this.gameOverPreventUsed = 0;
        this.history = [];
        this.spawnTile(false);
        this.spawnTile(false);
        // 开局升格（时空折叠者）：开局两个格子直升为 16
        if (this.buffs.initialBoost) {
            let upgraded = 0;
            for (let row = 0; row < this.size && upgraded < 2; row++) {
                for (let col = 0; col < this.size && upgraded < 2; col++) {
                    const tile = this.grid[row][col];
                    if (tile.value > 0) {
                        tile.value = 16;
                        tile.isBomb = undefined;
                        upgraded++;
                    }
                }
            }
            this.initialBoostTriggered = upgraded > 0;
        }
    }

    // ==================== SSR/UR 机制对外接口 ====================

    /** 时空折叠者：本局剩余撤销次数 */
    public getUndoLeft(): number {
        return this.undoLeft;
    }

    /** 时空折叠者：撤销上一步。成功返回 true 并恢复棋盘、分数、能量。 */
    public undo(): boolean {
        if (this.undoLeft <= 0 || this.history.length === 0) return false;
        const snap = this.history.shift()!;
        this.grid = snap.grid;
        this.score = snap.score;
        this.energy = snap.energy;
        this.bombNextSpawn = snap.bombNextSpawn;
        this.undoLeft--;
        this.undoUsed++;
        return true;
    }

    /** 熵寂主宰：空格不足 4 个时激活绝对领域——所有奇数位方块同化为奇数位最大数。成功返回 true。 */
    public tryActivateAbsoluteDomain(): boolean {
        if (this.absoluteDomainLeft <= 0) return false;
        if (this.emptyCells().length >= 4) return false;
        let oddMax = 0;
        let oddCount = 0;
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if ((row + col) % 2 === 1) {
                    const v = this.grid[row][col].value;
                    if (v > 0) {
                        oddCount++;
                        if (v > oddMax) oddMax = v;
                    }
                }
            }
        }
        // 至少要有两个奇数位方块且不是全部相同，同化才有意义
        if (oddCount < 2 || oddMax === 0) return false;
        let allSame = true;
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if ((row + col) % 2 === 1 && this.grid[row][col].value > 0
                    && this.grid[row][col].value !== oddMax) {
                    allSame = false;
                    break;
                }
            }
        }
        if (allSame) return false;
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if ((row + col) % 2 === 1 && this.grid[row][col].value > 0) {
                    this.grid[row][col].value = oddMax;
                    this.grid[row][col].isBomb = undefined;
                }
            }
        }
        this.absoluteDomainLeft--;
        this.absoluteDomainUsed++;
        return true;
    }

    /** 因果掌控者：棋盘卡死且仍有可用次数时，清除全屏所有 2/4 并将剩余方块随机重排。成功返回 true。 */
    public tryGameOverPrevent(): boolean {
        if (this.gameOverPreventLeft <= 0) return false;
        if (!this.isGameOver()) return false;
        
        this.gameOverPreventLeft--;
        this.gameOverPreventUsed++;
        // 倒流 3 回合
        for (let i = 0; i < 3; i++) {
            if (this.history.length > 0) {
                const snap = this.history.shift()!;
                this.grid = snap.grid.map(r => r.map(c => ({...c})));
                this.score = snap.score;
                this.energy = snap.energy;
                this.bombNextSpawn = snap.bombNextSpawn;
            }
        }
        
        // 消除 2 和 4
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col].value === 2 || this.grid[row][col].value === 4) {
                    this.grid[row][col] = this.emptyTile();
                }
            }
        }
        
        return true;
    }

    /** 创世主脑：返回合成 2048 时触发通关奖励的金币数（每局一次） */
    public consumeWin2048Reward(): number {
        if (this.win2048Rewarded || this.buffs.win2048Reward <= 0) return 0;
        let has2048 = false;
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                if (this.grid[row][col].value >= 2048) {
                    has2048 = true;
                    break;
                }
            }
        }
        if (!has2048) return 0;
        
        this.win2048Rewarded = true;
        return this.buffs.win2048Reward;
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

    /** 在随机空格生成普通 2/4/8 或待生成的炸弹方块。 */
    public spawnTile(allowRandomBomb: boolean = true): Pos | null {
        this.lastSpawnPaused = false;
        this.lastAbsoluteDomain = false;
        this.lastBombProbTriggered = false;
        this.lastSpawn8Triggered = false;
        
        // PAUSE_SPAWN (绝对零度)
        if (this.pauseSpawnLeft > 0 && this.emptyCells().length < 3) {
            this.pauseSpawnLeft--;
            this.pauseSpawnUsed++;
            this.lastSpawnPaused = true;
            return null;
        }

        // ABSOLUTE_DOMAIN (熵寂主宰)
        if (this.absoluteDomainLeft > 0 && this.emptyCells().length < 4) {
            if (this.tryActivateAbsoluteDomain()) {
                this.lastAbsoluteDomain = true;
            }
        }

        const cells = this.emptyCells();
        if (cells.length === 0) return null;

        const pos = cells[Math.floor(Math.random() * cells.length)];
        // 炸弹来源一：combo/能量触发的必出炸弹
        let isBomb = this.bombNextSpawn;
        // 炸弹来源二：称号 BOMB_PROB 独立随机路径（默认概率 0，不改变无称号基线）
        if (!isBomb && allowRandomBomb && this.buffs.bombProb > 0 && Math.random() < this.buffs.bombProb) {
            isBomb = true;
            this.lastBombProbTriggered = true;
        }

        // 数值保底（MIN_SPAWN_VALUE）：剔除低于保底值的权重项，并重新归一化
        const minValue = this.buffs.minSpawnValue;
        const weights = this.config.spawnWeights;
        let spawnValue = 2;
        if (minValue > 0) {
            const filtered = weights.filter((item) => item.value >= minValue);
            if (filtered.length > 0) {
                const total = filtered.reduce((sum, item) => sum + item.prob, 0);
                const norm = filtered.map((item) => ({ value: item.value, prob: item.prob / total }));
                const rand = Math.random();
                let cumulative = 0;
                for (const item of norm) {
                    cumulative += item.prob;
                    if (rand <= cumulative) {
                        spawnValue = item.value;
                        break;
                    }
                }
            } else {
                spawnValue = minValue;
            }
        } else {
            // 无保底时维持原难度权重逻辑
            const rand = Math.random();
            let cumulative = 0;
            for (const item of weights) {
                cumulative += item.prob;
                if (rand <= cumulative) {
                    spawnValue = item.value;
                    break;
                }
            }
        }
        // 额外概率生成 8（SPAWN_8_PROB，创世主脑）：独立于保底路径，避免与 MIN_SPAWN_VALUE 耦合
        if (this.buffs.spawn8Prob > 0 && Math.random() < this.buffs.spawn8Prob) {
            spawnValue = 8;
            this.lastSpawn8Triggered = true;
        }
        // 兜底：命中 8 不得低于保底值（若未来保底值 > 8，则该次保持保底值）
        if (minValue > 0 && spawnValue < minValue) {
            spawnValue = minValue;
        }

        this.grid[pos.row][pos.col] = {
            id: this.nextTileId++,
            value: spawnValue,
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
                this.appendMoves(moves, result, row, direction === 'left', false, values);
            }
        } else {
            for (let col = 0; col < this.size; col++) {
                const original: TileData[] = [];
                for (let row = 0; row < this.size; row++) original.push(this.grid[row][col]);

                const values = direction === 'up' ? original : original.slice().reverse();
                const result = this.slideLine(values);
                const output = direction === 'up' ? result.out : result.out.slice().reverse();
                for (let row = 0; row < this.size; row++) this.grid[row][col] = output[row];
                this.appendMoves(moves, result, col, direction === 'up', true, values);
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

        const mergedScore = realMoves.reduce((total, move) => total + (move.merged ? move.value : 0), 0);
        this.score += Math.floor(mergedScore * this.buffs.scoreMultiplier * this.buffs.comboScoreMultiplier);
        this.energy = Math.min(this.maxEnergy, this.energy + combo * this.config.energyPerMerge);
        if (combo >= this.config.comboForBomb || this.energy >= this.maxEnergy) this.bombNextSpawn = true;

        const explosionsInfo = this.resolveExplosions(realMoves);
        const explosions = explosionsInfo.explosions;
        let chainTriggered = explosionsInfo.chainTriggered;
        const bombNoDestroyTriggered = explosionsInfo.bombNoDestroyTriggered;

        let comboGoldBonus = 0;
        if (this.buffs.comboGoldBonus > 0 && combo >= 3) {
            comboGoldBonus = this.buffs.comboGoldBonus;
        }

        let goldDrops = 0;
        if (this.buffs.mergeGoldDropProb > 0) {
            for (let i = 0; i < combo; i++) {
                if (Math.random() < this.buffs.mergeGoldDropProb) {
                    goldDrops += 10;
                }
            }
        }

        let smallClearCount = 0;
        if (this.buffs.clearSmallThreshold > 0 && explosions.length > 0) {
            const threshold = this.buffs.clearSmallThreshold;
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    const tile = this.grid[row][col];
                    if (tile.value > 0 && tile.value <= threshold) {
                        this.score += tile.value * 2;
                        this.grid[row][col] = this.emptyTile();
                        smallClearCount++;
                    }
                }
            }
        }

        let gravityMerge: GravityMergeEvent | undefined;
        if (this.buffs.gravityMerge && explosions.length > 0) {
            let minVal = Infinity;
            for (let row = 0; row < this.size; row++) {
                for (let col = 0; col < this.size; col++) {
                    const val = this.grid[row][col].value;
                    if (val > 0 && val < minVal) {
                        minVal = val;
                    }
                }
            }
            if (minVal !== Infinity) {
                const candidates: Pos[] = [];
                for (let row = 0; row < this.size; row++) {
                    for (let col = 0; col < this.size; col++) {
                        if (this.grid[row][col].value === minVal) {
                            candidates.push({row, col});
                        }
                    }
                }
                if (candidates.length >= 2) {
                    const from1 = candidates[0];
                    const from2 = candidates[1];
                    const to = from1;
                    
                    this.grid[from1.row][from1.col].value = minVal * 2;
                    this.grid[from2.row][from2.col] = this.emptyTile();
                    
                    this.score += minVal * 2;
                    
                    gravityMerge = {
                        from: [from1, from2],
                        to: to,
                        value: minVal * 2
                    };
                }
            }
        }
        
        this.history.unshift({
            grid: this.grid.map(r => r.map(c => ({...c}))),
            score: this.score,
            energy: this.energy,
            bombNextSpawn: this.bombNextSpawn
        });
        if (this.history.length > this.undoLeft) {
            this.history.pop();
        }

        return {
            moves: realMoves,
            explosions,
            combo,
            energy: this.energy,
            maxEnergy: this.maxEnergy,
            bombNextSpawn: this.bombNextSpawn,
            comboGoldBonus,
            goldDrops,
            gravityMerge,
            chainTriggered,
            smallClearCount,
            bombNoDestroyTriggered,
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

    /**
     * 移除网格中数值最小的 count 个方块（复活机制使用）。
     * @param count 移除数量
     * @returns 移除的坐标数组
     */
    public removeSmallestTiles(count: number): Pos[] {
        const list: { pos: Pos, tile: TileData }[] = [];
        for (let row = 0; row < this.size; row++) {
            for (let col = 0; col < this.size; col++) {
                const tile = this.grid[row][col];
                if (tile.value > 0) {
                    list.push({ pos: { row, col }, tile });
                }
            }
        }
        // 按数值升序排列，如果数值相同则按位置任意顺序
        list.sort((a, b) => a.tile.value - b.tile.value);

        const removedPositions: Pos[] = [];
        const removeCount = Math.min(count, list.length);
        for (let i = 0; i < removeCount; i++) {
            const pos = list[i].pos;
            this.grid[pos.row][pos.col] = this.emptyTile();
            removedPositions.push(pos);
        }
        return removedPositions;
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

    private resolveExplosions(moves: TileMove[]): {
        explosions: ExplosionEvent[];
        chainTriggered: boolean;
        bombNoDestroyTriggered: boolean;
    } {
        const explosions: ExplosionEvent[] = [];
        const destroyedIds = new Set<number>();
        const radius = 1 + this.buffs.bombRangeExtra;
        const offsets = radius === 1
            ? blastOffsets(1)
            : blastOffsets(Math.max(1, Math.floor(radius)));
        
        let chainTriggered = false;
        let bombNoDestroyTriggered = false;
        const chainCenters: Pos[] = [];

        for (const move of moves) {
            if (!move.merged || !move.bombTriggered) continue;

            const noDestroy = this.buffs.bombNoDestroyProb > 0 && Math.random() < this.buffs.bombNoDestroyProb;
            if (noDestroy) bombNoDestroyTriggered = true;

            const targetPositions: Pos[] = [];
            const targetIds: number[] = [];
            let scoreGained = 0;
            for (const offset of offsets) {
                const row = move.to.row + offset.row;
                const col = move.to.col + offset.col;
                if (row < 0 || row >= this.size || col < 0 || col >= this.size) continue;
                if (row === move.to.row && col === move.to.col) continue;

                const tile = this.grid[row][col];
                if (tile.value === 0 || tile.value > move.value || destroyedIds.has(tile.id)) continue;

                if (noDestroy) {
                    // BOMB_NO_DESTROY：本次爆炸不毁方块只加分——不记录目标、不标记销毁、不触发十字冲击波
                    scoreGained += tile.value * 2;
                    continue;
                }

                if (this.buffs.chainExplosion && tile.value === move.value) {
                    chainTriggered = true;
                    chainCenters.push({ row, col });
                }

                targetPositions.push({ row, col });
                targetIds.push(tile.id);
                scoreGained += tile.value * 2;
                destroyedIds.add(tile.id);
                this.grid[row][col] = this.emptyTile();
            }

            this.score += Math.floor(scoreGained * this.buffs.bombScoreMultiplier);
            explosions.push({
                center: { row: move.to.row, col: move.to.col },
                value: move.value,
                targetPositions,
                targetIds,
                scoreGained,
            });
        }
        
        if (chainTriggered && chainCenters.length > 0) {
            const crossOffsets = [{row: -1, col: 0}, {row: 1, col: 0}, {row: 0, col: -1}, {row: 0, col: 1}];
            for (const center of chainCenters) {
                const targetPositions: Pos[] = [];
                const targetIds: number[] = [];
                let scoreGained = 0;
                for (const offset of crossOffsets) {
                    let r = center.row + offset.row;
                    let c = center.col + offset.col;
                    while (r >= 0 && r < this.size && c >= 0 && c < this.size) {
                        const tile = this.grid[r][c];
                        if (tile.value > 0 && !destroyedIds.has(tile.id)) {
                            targetPositions.push({ row: r, col: c });
                            targetIds.push(tile.id);
                            scoreGained += tile.value * 2;
                            destroyedIds.add(tile.id);
                            this.grid[r][c] = this.emptyTile();
                        }
                        r += offset.row;
                        c += offset.col;
                    }
                }
                if (targetPositions.length > 0) {
                    this.score += Math.floor(scoreGained * this.buffs.bombScoreMultiplier);
                    explosions.push({
                        center,
                        value: this.grid[center.row][center.col]?.value || 0,
                        targetPositions,
                        targetIds,
                        scoreGained
                    });
                }
            }
        }

        return { explosions, chainTriggered, bombNoDestroyTriggered };
    }
}
