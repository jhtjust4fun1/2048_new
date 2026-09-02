/**
 * GameManager.ts
 * 2048 游戏主控制组件（挂在场景 GameRoot 节点上）。
 * 负责：
 *  - 运行时动态构建全部 UI（标题、分数、棋盘、按钮、弹窗），无需图片资源
 *  - 键盘（方向键/WASD）与触摸滑动输入
 *  - 方块移动/合并/生成动画
 *  - 分数与最高分本地存档、胜利/游戏结束判定
 */

import {
    _decorator, Component, Node, Graphics, Label, Color, tween, Vec3,
    UITransform, sys, input, Input, EventKeyboard, KeyCode,
    EventTouch, Vec2, UIOpacity, Layers,
    view, ResolutionPolicy,
} from 'cc';
import {
    BoardLogic, Difficulty, DIFFICULTY_CONFIGS, Direction, ExplosionEvent,
    MoveResult, TileData, TileMove,
} from './BoardLogic';

const { ccclass, property } = _decorator;

/** 单个方块的渲染节点与数据 */
interface TileView {
    node: Node;
    label: Label;
    bombLabel: Label;
    id: number;
    value: number;
    isBomb: boolean;
    row: number;
    col: number;
}

/** 经典 2048 配色表 */
const TILE_COLORS: { bg: Color; text: Color }[] = [
    { bg: new Color(238, 228, 218), text: new Color(119, 110, 101) }, // 2
    { bg: new Color(237, 224, 200), text: new Color(119, 110, 101) }, // 4
    { bg: new Color(242, 177, 121), text: new Color(249, 246, 242) }, // 8
    { bg: new Color(245, 149, 99), text: new Color(249, 246, 242) },  // 16
    { bg: new Color(246, 124, 95), text: new Color(249, 246, 242) },  // 32
    { bg: new Color(246, 94, 59), text: new Color(249, 246, 242) },   // 64
    { bg: new Color(237, 207, 114), text: new Color(249, 246, 242) }, // 128
    { bg: new Color(237, 204, 97), text: new Color(249, 246, 242) },  // 256
    { bg: new Color(237, 200, 80), text: new Color(249, 246, 242) },  // 512
    { bg: new Color(237, 197, 63), text: new Color(249, 246, 242) },  // 1024
    { bg: new Color(237, 194, 46), text: new Color(249, 246, 242) },  // 2048
    { bg: new Color(60, 58, 50), text: new Color(249, 246, 242) },    // 4096+
];

const COLOR_BOARD_BG = new Color(187, 173, 160); // 棋盘背景
const COLOR_CELL_BG = new Color(205, 193, 180);  // 空格子背景
const COLOR_PANEL_BG = new Color(187, 173, 160); // 分数面板背景
const COLOR_BTN_BG = new Color(143, 122, 102);   // 按钮背景
const COLOR_TEXT_DARK = new Color(119, 110, 101);
const COLOR_TEXT_LIGHT = new Color(249, 246, 242);
const COLOR_MASK = new Color(0, 0, 0, 160);
const COLOR_ENERGY_BG = new Color(120, 99, 83);

// 动画时长（秒）
const MOVE_DURATION = 0.1;
const MERGE_DURATION = 0.08;
const SPAWN_DURATION = 0.14;

// 棋盘尺寸（设计分辨率 720x1280）
const CELL_SIZE = 136;
const GAP = 12;
const BOARD_SIZE = CELL_SIZE * 4 + GAP * 5; // 604
const BOARD_X = 0;
const BOARD_Y = 40;

@ccclass('GameManager')
export class GameManager extends Component {
    @property(Node)
    private boardRoot!: Node;                 // 场景中的棋盘容器
    @property(Label)
    private scoreLabel!: Label;
    @property(Label)
    private bestLabel!: Label;
    @property(Label)
    private difficultyLabel!: Label;
    @property(Label)
    private energyLabel!: Label;
    @property(Node)
    private energyBarBackground!: Node;
    @property(Node)
    private energyBarFill!: Node;
    @property(Node)
    private newGameButton!: Node;
    @property(Node)
    private difficultyOverlay!: Node;
    @property(Node)
    private difficultyPanel!: Node;
    @property(Node)
    private easyButton!: Node;
    @property(Node)
    private normalButton!: Node;
    @property(Node)
    private hardButton!: Node;
    @property(Node)
    private nightmareButton!: Node;
    @property(Node)
    private resultOverlay!: Node;
    @property(Node)
    private resultPanel!: Node;
    @property(Label)
    private resultTitle!: Label;
    @property(Label)
    private resultSubtitle!: Label;
    @property(Node)
    private resultRestartButton!: Node;

    private board!: BoardLogic;
    private tileMap: Map<number, TileView> = new Map(); // tileId -> 视图
    private isAnimating = false;
    private moveVersion = 0;
    private gameStarted = false;
    private won = false;
    private bestScore = 0;
    private difficulty: Difficulty = 'easy';
    private touchStart: Vec2 | null = null;

    protected onLoad(): void {
        // 构建配置可能来自旧的 Creator 会话，这里再做一次运行时兜底，确保竖屏 UI 不会跑出视口。
        view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
        this.bindSceneUI();
        this.setupSceneUI();
        this.loadBestScore();
        this.showDifficultySelection();
    }

    protected start(): void {
        // 键盘输入
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        // 触摸滑动
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        this.newGameButton.on(Node.EventType.TOUCH_END, this.restart, this);
        this.easyButton.on(Node.EventType.TOUCH_END, () => this.selectDifficulty('easy'), this);
        this.normalButton.on(Node.EventType.TOUCH_END, () => this.selectDifficulty('normal'), this);
        this.hardButton.on(Node.EventType.TOUCH_END, () => this.selectDifficulty('hard'), this);
        this.nightmareButton.on(Node.EventType.TOUCH_END, () => this.selectDifficulty('nightmare'), this);
        this.resultRestartButton.on(Node.EventType.TOUCH_END, this.restart, this);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
        // 场景加载或 onLoad 发生异常时，这些节点可能尚未绑定，销毁阶段不能再次抛错。
        if (this.newGameButton?.isValid) {
            this.newGameButton.off(Node.EventType.TOUCH_END, this.restart, this);
        }
        if (this.resultRestartButton?.isValid) {
            this.resultRestartButton.off(Node.EventType.TOUCH_END, this.restart, this);
        }
        this.moveVersion++;
    }

    // ==================== 场景 UI ====================

    /** 从场景节点绑定 UI，不再在运行时创建标题、面板、按钮或弹窗。 */
    private bindSceneUI(): void {
        const find = (name: string): Node => {
            const node = this.node.getChildByName(name);
            if (!node) throw new Error(`场景缺少 UI 节点：${name}`);
            return node;
        };
        const findLabel = (parent: Node, name: string): Label => {
            const node = parent.getChildByName(name);
            const label = node?.getComponent(Label);
            if (!label) throw new Error(`场景缺少 Label：${parent.name}/${name}`);
            return label;
        };

        this.boardRoot = find('BoardRoot');
        this.scoreLabel = findLabel(find('ScorePanel'), 'Value');
        this.bestLabel = findLabel(find('BestPanel'), 'Value');
        this.difficultyLabel = findLabel(this.node, 'DifficultyLabel');
        this.energyLabel = findLabel(find('EnergyPanel'), 'Value');
        this.energyBarBackground = find('EnergyBarBackground');
        this.energyBarFill = find('EnergyBarFill');
        this.newGameButton = find('NewGameButton');
        this.difficultyOverlay = find('DifficultyOverlay');
        this.difficultyPanel = this.difficultyOverlay.getChildByName('Panel')!;
        this.easyButton = this.difficultyOverlay.getChildByName('EasyButton')!;
        this.normalButton = this.difficultyOverlay.getChildByName('NormalButton')!;
        this.hardButton = this.difficultyOverlay.getChildByName('HardButton')!;
        this.nightmareButton = this.difficultyOverlay.getChildByName('NightmareButton')!;
        this.resultOverlay = find('ResultOverlay');
        this.resultPanel = this.resultOverlay.getChildByName('Panel')!;
        this.resultTitle = findLabel(this.resultPanel, 'Title');
        this.resultSubtitle = findLabel(this.resultPanel, 'Subtitle');
        this.resultRestartButton = findLabel(this.resultPanel, 'RestartButton').node;
    }

    /** 场景中的基础 UI 只绘制一次，节点位置和尺寸可直接在编辑器中调整。 */
    private setupSceneUI(): void {
        this.drawPanel(this.scoreLabel.node.parent!, COLOR_PANEL_BG, 10);
        this.drawPanel(this.bestLabel.node.parent!, COLOR_PANEL_BG, 10);
        this.drawPanel(this.newGameButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.easyButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.normalButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.hardButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.nightmareButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.resultRestartButton, COLOR_BTN_BG, 10);
        this.drawBoardGraphics();
        this.drawEnergyBarBackground();
        this.drawPanel(this.difficultyPanel, new Color(250, 248, 239), 14);
        this.drawPanel(this.resultPanel, new Color(250, 248, 239), 14);
        this.drawOverlayMask(this.difficultyOverlay);
        this.drawOverlayMask(this.resultOverlay);
        this.updateEnergy(0, 100);
    }

    private drawPanel(node: Node, color: Color, radius: number): void {
        const sourceTransform = node.getComponent(UITransform);
        if (!sourceTransform) return;

        // Label 派生节点不能再挂 Graphics。结果弹窗的重开按钮文字就在按钮节点上，
        // 因此改用一个子节点承载背景，避免与 Label 组件冲突。
        let drawNode = node;
        let transform = sourceTransform;
        if (node.getComponent(Label)) {
            drawNode = node.getChildByName('__PanelBackground') || new Node('__PanelBackground');
            if (!drawNode.parent) {
                node.addChild(drawNode);
                drawNode.layer = node.layer;
                drawNode.setPosition(0, 0, -1);
            }
            transform = drawNode.getComponent(UITransform) || drawNode.addComponent(UITransform);
            transform.setContentSize(sourceTransform.width, sourceTransform.height);
        }

        const graphics = drawNode.getComponent(Graphics) || drawNode.addComponent(Graphics);
        if (!graphics) return;
        graphics.clear();
        this.roundRect(graphics, -transform.width / 2, -transform.height / 2,
            transform.width, transform.height, radius);
        graphics.fillColor = color;
        graphics.fill();
    }

    private drawOverlayMask(node: Node): void {
        const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
        const transform = node.getComponent(UITransform);
        if (!graphics || !transform) return;
        graphics.clear();
        graphics.fillColor = COLOR_MASK;
        graphics.rect(-transform.width / 2, -transform.height / 2, transform.width, transform.height);
        graphics.fill();
    }

    private drawBoardGraphics(): void {
        const background = this.boardRoot.getComponent(Graphics) || this.boardRoot.addComponent(Graphics);
        if (background) {
            const half = BOARD_SIZE / 2;
            background.clear();
            this.roundRect(background, -half, -half, BOARD_SIZE, BOARD_SIZE, 12);
            background.fillColor = COLOR_BOARD_BG;
            background.fill();
        }

        // 场景中可能没有预置 Cell（例如场景被重建或被清空过），这里保证始终有 4×4 个格子。
        const cells = this.boardRoot.children.filter((child) => child.name === 'Cell');
        for (let i = cells.length; i < 16; i++) {
            const cell = new Node('Cell');
            cell.layer = Layers.Enum.UI_2D;
            this.boardRoot.addChild(cell);
            cells.push(cell);
        }

        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const row = Math.floor(i / 4);
            const col = i % 4;
            cell.setPosition(this.cellPos(row, col));
            const graphics = cell.getComponent(Graphics) || cell.addComponent(Graphics);
            const transform = cell.getComponent(UITransform) || cell.addComponent(UITransform);
            if (!graphics || !transform) continue;
            transform.setContentSize(CELL_SIZE, CELL_SIZE);
            graphics.clear();
            this.roundRect(graphics, -transform.width / 2, -transform.height / 2,
                transform.width, transform.height, 8);
            graphics.fillColor = COLOR_CELL_BG;
            graphics.fill();
        }
    }

    /** 绘制能量条底色；填充部分由 updateEnergy 根据当前能量重绘。 */
    private drawEnergyBarBackground(): void {
        const graphics = this.energyBarBackground.getComponent(Graphics)
            || this.energyBarBackground.addComponent(Graphics);
        const transform = this.energyBarBackground.getComponent(UITransform);
        if (!graphics || !transform) return;

        graphics.clear();
        this.roundRect(graphics, -transform.width / 2, -transform.height / 2,
            transform.width, transform.height, transform.height / 2);
        graphics.fillColor = COLOR_ENERGY_BG;
        graphics.fill();
    }

    // ==================== 难度选择 ====================

    private showDifficultySelection(): void {
        this.difficultyOverlay.active = true;
        this.resultOverlay.active = false;
    }

    private selectDifficulty(difficulty: Difficulty): void {
        this.difficulty = difficulty;
        this.difficultyLabel.string = `难度：${DIFFICULTY_CONFIGS[difficulty].label}`;
        this.loadBestScore();
        this.closeDifficultySelection();
        this.startGame();
    }

    private closeDifficultySelection(): void {
        this.difficultyOverlay.active = false;
    }

    // ==================== 游戏流程 ====================

    private startGame(): void {
        this.moveVersion++;
        this.isAnimating = false;
        this.board = new BoardLogic(4, this.difficulty); // 构造函数 reset() 已生成 2 个方块
        this.gameStarted = true;
        this.won = false;
        this.clearTiles();
        // 渲染棋盘上所有已有方块（避免重复 spawn）
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const tile = this.board.grid[r][c];
                if (tile.value !== 0) {
                    this.addTile(r, c, tile);
                }
            }
        }
        this.updateScore();
    }

    private restart(): void {
        this.closeOverlay();
        this.startGame();
    }

    private doMove(dir: Direction): void {
        if (!this.gameStarted || this.isAnimating) return;

        const result = this.board.move(dir);
        if (result.moves.length === 0) return;

        this.isAnimating = true;
        const moveVersion = this.moveVersion;
        let maxDur = 0;

        for (const m of result.moves) {
            const dur = this.animateMove(m, moveVersion);
            if (dur > maxDur) maxDur = dur;
        }

        // 动画全部结束后收尾
        const total = maxDur + 0.02;
        this.scheduleOnce(() => {
            if (moveVersion !== this.moveVersion) return;

            const explosionDuration = this.animateExplosions(result.explosions, moveVersion);
            this.scheduleOnce(() => {
                if (moveVersion !== this.moveVersion) return;

                // 爆炸动画完成后生成新方块并刷新界面。
                const pos = this.board.spawnTile();
                if (pos) {
                    this.addTile(pos.row, pos.col, this.board.grid[pos.row][pos.col], true);
                }
                this.updateScore();

                // 胜利判定（首次达到当前难度目标）
                if (!this.won && this.board.hasWon()) {
                    this.won = true;
                    this.scheduleOnce(() => {
                        if (moveVersion === this.moveVersion) {
                            const target = DIFFICULTY_CONFIGS[this.difficulty].target;
                            this.showOverlay('你赢了！', `已达到 ${target}，继续滑动即可不断挑战`, true);
                        }
                    }, 0.3);
                } else if (this.board.isGameOver()) {
                    this.scheduleOnce(() => {
                        if (moveVersion === this.moveVersion) {
                            this.showOverlay('游戏结束', `得分 ${this.board.score}`, false);
                        }
                    }, 0.3);
                }
                this.isAnimating = false;
            }, explosionDuration + 0.02);
        }, total);
    }

    /**
     * 驱动单条移动记录对应的动画。
     * @returns 该动画总时长
     */
    private animateMove(m: TileMove, moveVersion: number): number {
        const sourceTiles = m.sourceIds.map((id) => this.tileMap.get(id));
        const srcTile = sourceTiles[0];

        if (!srcTile) return 0;

        // 先保存所有来源视图，再从映射中移除；合并时第二个来源就是要销毁的节点。
        const victim = m.merged ? (sourceTiles[1] || null) : null;
        for (const id of m.sourceIds) this.tileMap.delete(id);

        if (m.merged) {
            // 合并：来源[1] 飞向目标并缩小消失
            const targetPos = this.cellPos(m.to.row, m.to.col);

            // 主方块：移动到目标 -> 弹跳放大 + 闪光 -> 回弹
            tween(srcTile.node)
                .to(MOVE_DURATION, { position: targetPos.clone() })
                .call(() => {
                    if (moveVersion !== this.moveVersion || !srcTile.node.isValid) return;
                    srcTile.value = m.value;
                    srcTile.isBomb = m.resultIsBomb;
                    this.renderTile(srcTile);
                    // 合并瞬间的粒子爆发
                    this.spawnMergeParticles(targetPos, this.tileColor(m.value).bg, m.value);
                    // 分数上浮提示
                    this.spawnScorePopup(targetPos, m.value);
                })
                .to(MERGE_DURATION, { scale: new Vec3(1.3, 1.3, 1) })
                .to(MERGE_DURATION, { scale: new Vec3(1, 1, 1) })
                .start();

            if (victim) {
                tween(victim.node)
                    .to(MOVE_DURATION, { position: targetPos.clone() })
                    .to(MERGE_DURATION * 2, { scale: new Vec3(0, 0, 1) })
                    .call(() => {
                        if (victim.node.isValid) victim.node.destroy();
                    })
                    .start();
            }

            // 更新主方块位置
            srcTile.row = m.to.row;
            srcTile.col = m.to.col;
            this.tileMap.set(srcTile.id, srcTile);
            return MOVE_DURATION + MERGE_DURATION * 2;
        } else {
            // 普通移动
            const targetPos = this.cellPos(m.to.row, m.to.col);
            tween(srcTile.node)
                .to(MOVE_DURATION, { position: targetPos.clone() })
                .start();
            srcTile.row = m.to.row;
            srcTile.col = m.to.col;
            this.tileMap.set(srcTile.id, srcTile);
            return MOVE_DURATION;
        }
    }

    // ==================== 方块管理 ====================

    private cellPos(row: number, col: number): Vec3 {
        const x = (col - 1.5) * (CELL_SIZE + GAP);
        const y = (1.5 - row) * (CELL_SIZE + GAP);
        return new Vec3(x, y, 0);
    }

    /** 添加一个方块到棋盘指定格 */
    private addTile(row: number, col: number, tile: TileData, animated = false): void {
        const node = new Node('Tile');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(this.cellPos(row, col));
        this.boardRoot.addChild(node);

        const g = node.addComponent(Graphics);
        const cs = CELL_SIZE - 8;
        this.roundRect(g, -cs / 2, -cs / 2, cs, cs, 8);
        g.fillColor = tile.isBomb ? this.bombColor().bg : this.tileColor(tile.value).bg;
        g.fill();

        const label = this.makeLabel('', 44, this.tileColor(tile.value).text, node, Vec3.ZERO);
        const bombLabel = this.makeLabel('炸弹', 18, COLOR_TEXT_LIGHT, node, new Vec3(0, 42, 0));

        const tv: TileView = {
            node,
            label,
            bombLabel,
            id: tile.id,
            value: tile.value,
            isBomb: !!tile.isBomb,
            row,
            col,
        };
        this.renderTile(tv);
        this.tileMap.set(tile.id, tv);

        if (animated) {
            // 生成弹出动画
            node.setScale(0, 0, 1);
            tween(node)
                .to(SPAWN_DURATION, { scale: new Vec3(1.08, 1.08, 1) })
                .to(0.06, { scale: new Vec3(1, 1, 1) })
                .start();
        }
    }

    /** 清理旧方块，但保留棋盘背景和 16 个空格子。 */
    private clearTiles(): void {
        for (const tile of this.tileMap.values()) {
            if (tile.node.isValid) tile.node.destroy();
        }
        this.tileMap.clear();

        // 重开时同时清理上一局尚未播放完的临时特效，保留棋盘背景和 Cell 节点。
        for (const child of this.boardRoot.children) {
            if (child.name === 'Particle' || child.name === 'ExplosionFlash' || child.name === 'ScorePopup') {
                child.destroy();
            }
        }
    }

    private renderTile(tv: TileView): void {
        tv.label.string = String(tv.value);
        const colors = tv.isBomb
            ? { bg: new Color(214, 70, 48), text: COLOR_TEXT_LIGHT }
            : this.tileColor(tv.value);
        tv.bombLabel.node.active = tv.isBomb;
        // 根据位数调整字号
        const digits = String(tv.value).length;
        tv.label.fontSize = digits <= 2 ? 52 : digits === 3 ? 44 : digits === 4 ? 34 : 28;
        tv.label.color = colors.text;
        const g = tv.node.getComponent(Graphics)!;
        g.clear();
        const cs = CELL_SIZE - 8;
        this.roundRect(g, -cs / 2, -cs / 2, cs, cs, 8);
        g.fillColor = colors.bg;
        g.fill();
    }

    private bombColor(): { bg: Color; text: Color } {
        return { bg: new Color(214, 70, 48), text: COLOR_TEXT_LIGHT };
    }

    private tileColor(value: number): { bg: Color; text: Color } {
        const idx = Math.min(Math.floor(Math.log2(value)) - 1, TILE_COLORS.length - 1);
        return TILE_COLORS[idx >= 0 ? idx : 0];
    }

    /**
     * 合成时在目标位置爆发的彩色粒子特效。
     * 粒子数量随合成值增大而增多，向外四散并淡出。
     */
    private spawnMergeParticles(pos: Vec3, color: Color, value: number): void {
        const count = Math.min(6 + Math.floor(Math.log2(value)), 16);
        for (let i = 0; i < count; i++) {
            const p = new Node('Particle');
            p.layer = Layers.Enum.UI_2D;
            p.setPosition(pos.clone());
            this.boardRoot.addChild(p);

            const g = p.addComponent(Graphics);
            const radius = 4 + Math.random() * 4;
            g.circle(0, 0, radius);
            g.fillColor = color;
            g.fill();

            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.5;
            const dist = 30 + Math.random() * 45;
            const target = new Vec3(
                pos.x + Math.cos(angle) * dist,
                pos.y + Math.sin(angle) * dist,
                0,
            );
            const dur = 0.22 + Math.random() * 0.18;

            const op = p.addComponent(UIOpacity);
            op.opacity = 255;

            tween(p)
                .to(dur, { position: target })
                .call(() => p.destroy())
                .start();
            tween(op)
                .to(dur * 0.7, { opacity: 0 })
                .start();
        }
    }

    /** 播放 3x3 范围爆炸，并销毁逻辑层标记的目标方块节点。 */
    private animateExplosions(events: ExplosionEvent[], moveVersion: number): number {
        if (events.length === 0) return 0;

        const removedIds = new Set<number>();
        for (const event of events) {
            const center = this.cellPos(event.center.row, event.center.col);
            this.spawnExplosionParticles(center, event.value);
            for (const id of event.targetIds) {
                if (removedIds.has(id)) continue;
                removedIds.add(id);

                const tile = this.tileMap.get(id);
                if (!tile) continue;
                this.tileMap.delete(id);
                tween(tile.node)
                    .to(0.16, { scale: new Vec3(1.18, 1.18, 1) })
                    .to(0.16, { scale: new Vec3(0, 0, 1) })
                    .call(() => {
                        if (moveVersion === this.moveVersion && tile.node.isValid) {
                            tile.node.destroy();
                        }
                    })
                    .start();
            }
        }
        return 0.32;
    }

    /** 爆炸粒子：中心闪光 + 多方向彩色粒子。 */
    private spawnExplosionParticles(pos: Vec3, value: number): void {
        const flash = new Node('ExplosionFlash');
        flash.layer = Layers.Enum.UI_2D;
        flash.setPosition(pos.clone());
        this.boardRoot.addChild(flash);
        const flashGraphics = flash.addComponent(Graphics);
        flashGraphics.circle(0, 0, 38);
        flashGraphics.fillColor = new Color(255, 226, 120, 220);
        flashGraphics.fill();
        const flashOpacity = flash.addComponent(UIOpacity);
        flashOpacity.opacity = 255;
        tween(flash)
            .to(0.3, { scale: new Vec3(2.1, 2.1, 1) })
            .call(() => {
                if (flash.isValid) flash.destroy();
            })
            .start();
        tween(flashOpacity).to(0.3, { opacity: 0 }).start();

        const count = Math.min(28, 16 + Math.floor(Math.log2(value)) * 2);
        for (let i = 0; i < count; i++) {
            const particle = new Node('Particle');
            particle.layer = Layers.Enum.UI_2D;
            particle.setPosition(pos.clone());
            this.boardRoot.addChild(particle);

            const graphics = particle.addComponent(Graphics);
            const radius = 3 + Math.random() * 5;
            graphics.circle(0, 0, radius);
            graphics.fillColor = i % 2 === 0
                ? new Color(255, 128, 48)
                : new Color(255, 224, 92);
            graphics.fill();

            const angle = (Math.PI * 2 * i) / count + Math.random() * 0.3;
            const distance = 75 + Math.random() * 95;
            const target = new Vec3(
                pos.x + Math.cos(angle) * distance,
                pos.y + Math.sin(angle) * distance,
                0,
            );
            const duration = 0.28 + Math.random() * 0.18;
            const opacity = particle.addComponent(UIOpacity);
            opacity.opacity = 255;
            tween(particle)
                .to(duration, { position: target, scale: new Vec3(0.2, 0.2, 1) })
                .call(() => {
                    if (particle.isValid) particle.destroy();
                })
                .start();
            tween(opacity).to(duration * 0.75, { opacity: 0 }).start();
        }
    }

    /** 合成时在目标位置弹出的分数上浮提示（参考原版 2048 score-addition） */
    private spawnScorePopup(pos: Vec3, value: number): void {
        const node = new Node('ScorePopup');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(pos.clone());
        this.boardRoot.addChild(node);

        const label = this.makeLabel(`+${value}`, 32, COLOR_TEXT_DARK, node, Vec3.ZERO);
        label.fontSize = 32;

        const op = node.addComponent(UIOpacity);
        op.opacity = 255;

        tween(node)
            .to(0.55, { position: new Vec3(pos.x, pos.y + 70, 0) })
            .call(() => node.destroy())
            .start();
        tween(op)
            .delay(0.2)
            .to(0.35, { opacity: 0 })
            .start();
    }

    private updateScore(): void {
        this.scoreLabel.string = String(this.board.score);
        if (this.board.score > this.bestScore) {
            this.bestScore = this.board.score;
            sys.localStorage.setItem(this.bestScoreKey(), String(this.bestScore));
        }
        this.bestLabel.string = String(this.bestScore);
        this.updateEnergy(this.board.energy, this.board.maxEnergy);
    }

    private updateEnergy(energy: number, maxEnergy: number): void {
        const ratio = maxEnergy > 0 ? Math.max(0, Math.min(1, energy / maxEnergy)) : 0;
        this.energyLabel.string = `能量 ${energy}/${maxEnergy}`;

        const graphics = this.energyBarFill.getComponent(Graphics)
            || this.energyBarFill.addComponent(Graphics);
        const transform = this.energyBarFill.getComponent(UITransform);
        if (!graphics || !transform) return;
        graphics.clear();
        this.roundRect(graphics, 0, -transform.height / 2,
            transform.width * ratio, transform.height, transform.height / 2);
        graphics.fillColor = ratio >= 1 ? new Color(255, 94, 59) : new Color(255, 196, 74);
        graphics.fill();
    }

    private bestScoreKey(): string {
        return `2048_best_score_${this.difficulty}`;
    }

    /** 读取当前难度的最高分；简单模式兼容旧版全局最高分存档。 */
    private loadBestScore(): void {
        const key = this.bestScoreKey();
        let saved = sys.localStorage.getItem(key);
        if (!saved && this.difficulty === 'easy') {
            saved = sys.localStorage.getItem('2048_best_score');
        }
        this.bestScore = saved ? parseInt(saved, 10) || 0 : 0;
        if (this.bestLabel) {
            this.bestLabel.string = String(this.bestScore);
        }
    }

    // ==================== 输入 ====================

    private onKeyDown(e: EventKeyboard): void {
        switch (e.keyCode) {
            case KeyCode.ARROW_UP:
            case KeyCode.KEY_W: this.doMove('up'); break;
            case KeyCode.ARROW_DOWN:
            case KeyCode.KEY_S: this.doMove('down'); break;
            case KeyCode.ARROW_LEFT:
            case KeyCode.KEY_A: this.doMove('left'); break;
            case KeyCode.ARROW_RIGHT:
            case KeyCode.KEY_D: this.doMove('right'); break;
        }
    }

    private onTouchStart(e: EventTouch): void {
        this.touchStart = e.getUILocation().clone();
    }

    private onTouchEnd(e: EventTouch): void {
        if (!this.touchStart) return;
        const end = e.getUILocation();
        const dx = end.x - this.touchStart.x;
        const dy = end.y - this.touchStart.y;
        const THRESHOLD = 30;
        this.touchStart = null;

        if (Math.abs(dx) < THRESHOLD && Math.abs(dy) < THRESHOLD) return;

        if (Math.abs(dx) > Math.abs(dy)) {
            this.doMove(dx > 0 ? 'right' : 'left');
        } else {
            this.doMove(dy > 0 ? 'up' : 'down');
        }
    }

    // ==================== 弹窗 ====================

    private showOverlay(title: string, subtitle: string, isWin: boolean): void {
        if (this.resultOverlay.active) return;
        this.resultTitle.string = title;
        this.resultSubtitle.string = subtitle;
        this.resultOverlay.active = true;
        const opacity = this.resultOverlay.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity).to(0.25, { opacity: 255 }).start();
        }
    }

    private closeOverlay(): void {
        this.resultOverlay.active = false;
    }

    // ==================== 工具方法 ====================

    /** 创建文字节点 */
    private makeLabel(
        text: string,
        fontSize: number,
        color: Color,
        parent: Node,
        pos: Vec3,
    ): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(pos);
        parent.addChild(node);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.3);
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        return label;
    }

    /** 绘制圆角矩形路径 */
    private roundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
        r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
        g.roundRect(x, y, w, h, r);
    }
}
