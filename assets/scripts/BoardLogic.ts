/**
 * BoardLogic.ts
 * 2048 棋盘核心逻辑（纯 TypeScript，不依赖引擎渲染层）。
 * 负责：棋盘数据、方块生成、四个方向的移动与合并、得分计算、结束/胜利判定。
 * 每次 move() 会返回详细的移动记录，供上层驱动动画。
 */

export type Direction = 'up' | 'down' | 'left' | 'right';

/** 棋盘上的一个坐标 */
export interface Pos {
    row: number;
    col: number;
}

/** 一次移动记录：某个目标格子的值由哪些来源格子的方块产生 */
export interface TileMove {
    /** 来源坐标（合并时含两个来源） */
    from: Pos[];
    /** 目标坐标 */
    to: Pos;
    /** 目标格子的值 */
    value: number;
    /** 是否发生了合并 */
    merged: boolean;
}

export class BoardLogic {
    /** 棋盘维度（4x4） */
    public readonly size: number;
    /** 当前棋盘数据，grid[row][col]，0 表示空格 */
    public grid: number[][];
    /** 当前分数 */
    public score: number;

    constructor(size: number = 4) {
        this.size = size;
        this.grid = [];
        this.score = 0;
        this.reset();
    }

    /** 重置棋盘并生成两个初始方块 */
    public reset(): void {
        this.grid = [];
        for (let r = 0; r < this.size; r++) {
            this.grid.push(new Array<number>(this.size).fill(0));
        }
        this.score = 0;
        this.spawnTile();
        this.spawnTile();
    }

    /** 获取空格子列表 */
    public emptyCells(): Pos[] {
        const cells: Pos[] = [];
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (this.grid[r][c] === 0) {
                    cells.push({ row: r, col: c });
                }
            }
        }
        return cells;
    }

    /** 在随机空格子生成一个新方块（90% 为 2，10% 为 4）。无可放位置时返回 null */
    public spawnTile(): Pos | null {
        const empty = this.emptyCells();
        if (empty.length === 0) {
            return null;
        }
        const pos = empty[Math.floor(Math.random() * empty.length)];
        this.grid[pos.row][pos.col] = Math.random() < 0.9 ? 2 : 4;
        return pos;
    }

    /**
     * 压缩并合并一行（从左到右方向）。
     * @param values 原始一行数据
     * @returns 处理后的行，以及每个目标位置对应的来源索引
     */
    private slideLine(values: number[]): { out: number[]; src: number[][] } {
        // 提取非零元素（保持顺序）
        const nonzero = values
            .map((v, i) => ({ v, i }))
            .filter((x) => x.v !== 0);

        const out: number[] = [];
        const src: number[][] = [];

        let i = 0;
        while (i < nonzero.length) {
            if (i + 1 < nonzero.length && nonzero[i].v === nonzero[i + 1].v) {
                out.push(nonzero[i].v * 2);
                src.push([nonzero[i].i, nonzero[i + 1].i]);
                i += 2;
            } else {
                out.push(nonzero[i].v);
                src.push([nonzero[i].i]);
                i += 1;
            }
        }
        // 补齐空格
        while (out.length < values.length) {
            out.push(0);
            src.push([]);
        }
        return { out, src };
    }

    /**
     * 按指定方向移动并合并所有方块。
     * @returns 移动记录；若无任何移动（含无合并）返回空数组
     */
    public move(dir: Direction): TileMove[] {
        const moves: TileMove[] = [];
        const n = this.size;

        if (dir === 'left') {
            for (let r = 0; r < n; r++) {
                const line = this.grid[r].slice();
                const { out, src } = this.slideLine(line);
                for (let c = 0; c < n; c++) {
                    this.grid[r][c] = out[c];
                }
                for (let c = 0; c < n; c++) {
                    if (src[c].length === 0) continue;
                    moves.push({
                        from: src[c].map((i) => ({ row: r, col: i })),
                        to: { row: r, col: c },
                        value: out[c],
                        merged: src[c].length === 2,
                    });
                }
            }
        } else if (dir === 'right') {
            for (let r = 0; r < n; r++) {
                const rev = this.grid[r].slice().reverse();
                const { out, src } = this.slideLine(rev);
                for (let c = 0; c < n; c++) {
                    this.grid[r][n - 1 - c] = out[c];
                }
                for (let k = 0; k < n; k++) {
                    if (src[k].length === 0) continue;
                    moves.push({
                        from: src[k].map((i) => ({ row: r, col: n - 1 - i })),
                        to: { row: r, col: n - 1 - k },
                        value: out[k],
                        merged: src[k].length === 2,
                    });
                }
            }
        } else if (dir === 'up') {
            for (let c = 0; c < n; c++) {
                const col = [];
                for (let r = 0; r < n; r++) col.push(this.grid[r][c]);
                const { out, src } = this.slideLine(col);
                for (let r = 0; r < n; r++) {
                    this.grid[r][c] = out[r];
                }
                for (let k = 0; k < n; k++) {
                    if (src[k].length === 0) continue;
                    moves.push({
                        from: src[k].map((i) => ({ row: i, col: c })),
                        to: { row: k, col: c },
                        value: out[k],
                        merged: src[k].length === 2,
                    });
                }
            }
        } else if (dir === 'down') {
            for (let c = 0; c < n; c++) {
                const col = [];
                for (let r = n - 1; r >= 0; r--) col.push(this.grid[r][c]);
                const { out, src } = this.slideLine(col);
                for (let r = 0; r < n; r++) {
                    this.grid[n - 1 - r][c] = out[r];
                }
                for (let k = 0; k < n; k++) {
                    if (src[k].length === 0) continue;
                    moves.push({
                        from: src[k].map((i) => ({ row: n - 1 - i, col: c })),
                        to: { row: n - 1 - k, col: c },
                        value: out[k],
                        merged: src[k].length === 2,
                    });
                }
            }
        }

        // 过滤掉「未真正移动」的占位记录：只有发生位移或合并的记录才保留
        const realMoves = moves.filter((m) => {
            if (m.merged) return true;
            const f = m.from[0];
            return f.row !== m.to.row || f.col !== m.to.col;
        });

        // 只有发生真实移动或合并才累加分数
        if (realMoves.length > 0) {
            for (const m of realMoves) {
                if (m.merged) {
                    this.score += m.value;
                }
            }
        }
        return realMoves;
    }

    /** 是否存在空格 */
    public hasEmpty(): boolean {
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (this.grid[r][c] === 0) return true;
            }
        }
        return false;
    }

    /** 棋盘上是否有相邻相等（可继续合并） */
    public hasAdjacentEqual(): boolean {
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                const v = this.grid[r][c];
                if (v === 0) continue;
                if (c + 1 < this.size && this.grid[r][c + 1] === v) return true;
                if (r + 1 < this.size && this.grid[r + 1][c] === v) return true;
            }
        }
        return false;
    }

    /** 游戏是否已结束（无法再移动） */
    public isGameOver(): boolean {
        return !this.hasEmpty() && !this.hasAdjacentEqual();
    }

    /** 是否达到胜利值 */
    public hasWon(target: number = 2048): boolean {
        for (let r = 0; r < this.size; r++) {
            for (let c = 0; c < this.size; c++) {
                if (this.grid[r][c] >= target) return true;
            }
        }
        return false;
    }
}
