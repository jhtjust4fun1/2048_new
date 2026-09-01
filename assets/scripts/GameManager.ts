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
} from 'cc';
import { BoardLogic, Direction, TileMove } from './BoardLogic';

const { ccclass } = _decorator;

/** 单个方块的渲染节点与数据 */
interface TileView {
    node: Node;
    label: Label;
    value: number;
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
    private board!: BoardLogic;
    private boardRoot!: Node;                 // 棋盘容器（方块挂在这里）
    private tileMap: Map<number, TileView> = new Map();
    private scoreLabel!: Label;
    private bestLabel!: Label;
    private isAnimating = false;
    private won = false;
    private bestScore = 0;
    private overlay: Node | null = null;
    private touchStart: Vec2 | null = null;

    protected onLoad(): void {
        // 读取最高分存档
        const saved = sys.localStorage.getItem('2048_best_score');
        this.bestScore = saved ? parseInt(saved, 10) || 0 : 0;
        this.buildUI();
        this.startGame();
    }

    protected start(): void {
        // 键盘输入
        input.on(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        // 触摸滑动
        this.node.on(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.on(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    protected onDestroy(): void {
        input.off(Input.EventType.KEY_DOWN, this.onKeyDown, this);
        this.node.off(Node.EventType.TOUCH_START, this.onTouchStart, this);
        this.node.off(Node.EventType.TOUCH_END, this.onTouchEnd, this);
    }

    // ==================== UI 构建 ====================

    private buildUI(): void {
        // 标题
        this.makeLabel('2048', 92, COLOR_TEXT_DARK, this.node, new Vec3(0, 540, 0));

        // 分数面板
        this.buildScorePanel();

        // 棋盘
        this.buildBoard();

        // 新游戏按钮
        this.makeButton('新游戏', new Vec3(0, -430, 0), 220, 76, () => this.restart());

        // 操作提示
        this.makeLabel('方向键 / WASD / 滑动 控制', 24, new Color(187, 173, 160), this.node, new Vec3(0, -520, 0));
    }

    private buildScorePanel(): void {
        // 当前分数框
        const sBox = this.makePanel(new Vec3(-120, 460, 0));
        this.makeLabel('分数', 24, COLOR_TEXT_LIGHT, sBox, new Vec3(0, 22, 0));
        this.scoreLabel = this.makeLabel('0', 40, COLOR_TEXT_LIGHT, sBox, new Vec3(0, -22, 0));

        // 最高分框
        const bBox = this.makePanel(new Vec3(120, 460, 0));
        this.makeLabel('最高分', 24, COLOR_TEXT_LIGHT, bBox, new Vec3(0, 22, 0));
        this.bestLabel = this.makeLabel(String(this.bestScore), 40, COLOR_TEXT_LIGHT, bBox, new Vec3(0, -22, 0));
    }

    /** 绘制一个圆角矩形面板节点 */
    private makePanel(pos: Vec3, size?: { w: number; h: number }): Node {
        const w = size ? size.w : 170;
        const h = size ? size.h : 96;
        const node = new Node('Panel');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(pos);
        this.node.addChild(node);

        const g = node.addComponent(Graphics);
        this.roundRect(g, -w / 2, -h / 2, w, h, 10);
        g.fillColor = COLOR_PANEL_BG;
        g.fill();
        return node;
    }

    /** 绘制棋盘背景与 16 个空格子 */
    private buildBoard(): void {
        this.boardRoot = new Node('BoardRoot');
        this.boardRoot.layer = Layers.Enum.UI_2D;
        this.boardRoot.setPosition(BOARD_X, BOARD_Y, 0);
        this.node.addChild(this.boardRoot);

        // 棋盘外框背景
        const bg = this.boardRoot.addComponent(Graphics);
        const half = BOARD_SIZE / 2;
        this.roundRect(bg, -half, -half, BOARD_SIZE, BOARD_SIZE, 12);
        bg.fillColor = COLOR_BOARD_BG;
        bg.fill();

        // 16 个空格子
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const cell = new Node('Cell');
                cell.layer = Layers.Enum.UI_2D;
                cell.setPosition(this.cellPos(r, c));
                this.boardRoot.addChild(cell);
                const g = cell.addComponent(Graphics);
                const cs = CELL_SIZE;
                this.roundRect(g, -cs / 2, -cs / 2, cs, cs, 8);
                g.fillColor = COLOR_CELL_BG;
                g.fill();
            }
        }
    }

    // ==================== 游戏流程 ====================

    private startGame(): void {
        this.board = new BoardLogic(4);
        this.won = false;
        this.tileMap.clear();
        this.boardRoot.removeAllChildren();
        // 初始两个方块
        for (let i = 0; i < 2; i++) {
            const pos = this.board.spawnTile();
            if (pos) {
                this.addTile(pos.row, pos.col, this.board.grid[pos.row][pos.col]);
            }
        }
        this.updateScore();
    }

    private restart(): void {
        this.closeOverlay();
        this.startGame();
    }

    private doMove(dir: Direction): void {
        if (this.isAnimating) return;

        const moves = this.board.move(dir);
        if (moves.length === 0) return;

        this.isAnimating = true;
        let maxDur = 0;

        for (const m of moves) {
            const dur = this.animateMove(m);
            if (dur > maxDur) maxDur = dur;
        }

        // 动画全部结束后收尾
        const total = maxDur + 0.02;
        this.scheduleOnce(() => {
            // 生成新方块
            const pos = this.board.spawnTile();
            if (pos) {
                this.addTile(pos.row, pos.col, this.board.grid[pos.row][pos.col], true);
            }
            this.updateScore();

            // 胜利判定（首次达到 2048）
            if (!this.won && this.board.hasWon(2048)) {
                this.won = true;
                this.scheduleOnce(() => this.showOverlay('你赢了！', '继续滑动即可不断挑战', true), 0.3);
            } else if (this.board.isGameOver()) {
                this.scheduleOnce(() => this.showOverlay('游戏结束', `得分 ${this.board.score}`, false), 0.3);
            }
            this.isAnimating = false;
        }, total);
    }

    /**
     * 驱动单条移动记录对应的动画。
     * @returns 该动画总时长
     */
    private animateMove(m: TileMove): number {
        const toKey = this.keyOf(m.to.row, m.to.col);
        const fromKeys = m.from.map((p) => this.keyOf(p.row, p.col));
        const srcTile = this.tileMap.get(fromKeys[0]);

        if (!srcTile) return 0;

        // 从 tileMap 中移除来源
        for (const k of fromKeys) this.tileMap.delete(k);

        if (m.merged) {
            // 合并：来源[1] 飞向目标并缩小消失
            const victim = this.tileMap.get(fromKeys[1]) || null;
            const targetPos = this.cellPos(m.to.row, m.to.col);

            // 主方块：移动到目标 -> 弹出合并动画
            tween(srcTile.node)
                .to(MOVE_DURATION, { position: targetPos.clone() })
                .call(() => {
                    srcTile.value = m.value;
                    this.renderTile(srcTile);
                })
                .to(MERGE_DURATION, { scale: new Vec3(1.2, 1.2, 1) })
                .to(MERGE_DURATION, { scale: new Vec3(1, 1, 1) })
                .start();

            if (victim) {
                tween(victim.node)
                    .to(MOVE_DURATION, { position: targetPos.clone() })
                    .to(MERGE_DURATION * 2, { scale: new Vec3(0, 0, 1) })
                    .call(() => victim.node.destroy())
                    .start();
            }

            // 更新主方块位置
            srcTile.row = m.to.row;
            srcTile.col = m.to.col;
            this.tileMap.set(toKey, srcTile);
            return MOVE_DURATION + MERGE_DURATION * 2;
        } else {
            // 普通移动
            const targetPos = this.cellPos(m.to.row, m.to.col);
            tween(srcTile.node)
                .to(MOVE_DURATION, { position: targetPos.clone() })
                .start();
            srcTile.row = m.to.row;
            srcTile.col = m.to.col;
            this.tileMap.set(toKey, srcTile);
            return MOVE_DURATION;
        }
    }

    // ==================== 方块管理 ====================

    private keyOf(row: number, col: number): number {
        return row * 4 + col;
    }

    private cellPos(row: number, col: number): Vec3 {
        const x = (col - 1.5) * (CELL_SIZE + GAP);
        const y = (1.5 - row) * (CELL_SIZE + GAP);
        return new Vec3(x, y, 0);
    }

    /** 添加一个方块到棋盘指定格 */
    private addTile(row: number, col: number, value: number, animated = false): void {
        const node = new Node('Tile');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(this.cellPos(row, col));
        this.boardRoot.addChild(node);

        const g = node.addComponent(Graphics);
        const cs = CELL_SIZE - 8;
        this.roundRect(g, -cs / 2, -cs / 2, cs, cs, 8);
        g.fillColor = this.tileColor(value).bg;
        g.fill();

        const label = this.makeLabel('', 44, this.tileColor(value).text, node, Vec3.ZERO);

        const tv: TileView = { node, label, value, row, col };
        this.renderTile(tv);
        this.tileMap.set(this.keyOf(row, col), tv);

        if (animated) {
            // 生成弹出动画
            node.setScale(0, 0, 1);
            tween(node)
                .to(SPAWN_DURATION, { scale: new Vec3(1.08, 1.08, 1) })
                .to(0.06, { scale: new Vec3(1, 1, 1) })
                .start();
        }
    }

    private renderTile(tv: TileView): void {
        tv.label.string = String(tv.value);
        const colors = this.tileColor(tv.value);
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

    private tileColor(value: number): { bg: Color; text: Color } {
        const idx = Math.min(Math.floor(Math.log2(value)) - 1, TILE_COLORS.length - 1);
        return TILE_COLORS[idx >= 0 ? idx : 0];
    }

    private updateScore(): void {
        this.scoreLabel.string = String(this.board.score);
        if (this.board.score > this.bestScore) {
            this.bestScore = this.board.score;
            sys.localStorage.setItem('2048_best_score', String(this.bestScore));
        }
        this.bestLabel.string = String(this.bestScore);
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
        if (this.overlay) return;
        const overlay = new Node('Overlay');
        overlay.layer = Layers.Enum.UI_2D;
        this.node.addChild(overlay);

        // 半透明遮罩
        const maskG = overlay.addComponent(Graphics);
        maskG.fillColor = COLOR_MASK;
        maskG.rect(-360, -640, 720, 1280);
        maskG.fill();

        // 面板
        const panel = this.makePanel(new Vec3(0, 0, 0), { w: 480, h: 360 });
        panel.parent = overlay;

        this.makeLabel(title, 64, COLOR_TEXT_DARK, panel, new Vec3(0, 80, 0));
        this.makeLabel(subtitle, 32, COLOR_TEXT_DARK, panel, new Vec3(0, 0, 0));

        const btn = new Node('RestartBtn');
        btn.layer = Layers.Enum.UI_2D;
        btn.setPosition(0, -90, 0);
        panel.addChild(btn);
        const bg = btn.addComponent(Graphics);
        this.roundRect(bg, -110, -36, 220, 72, 10);
        bg.fillColor = COLOR_BTN_BG;
        bg.fill();
        this.makeLabel('再来一局', 34, COLOR_TEXT_LIGHT, btn, Vec3.ZERO);
        btn.on(Node.EventType.TOUCH_END, () => this.restart(), this);

        // 淡入
        const op = overlay.addComponent(UIOpacity);
        op.opacity = 0;
        tween(op).to(0.25, { opacity: 255 }).start();

        this.overlay = overlay;
    }

    private closeOverlay(): void {
        if (this.overlay) {
            this.overlay.destroy();
            this.overlay = null;
        }
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

    /** 创建按钮节点（圆角矩形背景 + 文字 + 点击回调） */
    private makeButton(text: string, pos: Vec3, w: number, h: number, onClick: () => void): void {
        const btn = new Node('Button');
        btn.layer = Layers.Enum.UI_2D;
        btn.setPosition(pos);
        this.node.addChild(btn);

        const g = btn.addComponent(Graphics);
        this.roundRect(g, -w / 2, -h / 2, w, h, 10);
        g.fillColor = COLOR_BTN_BG;
        g.fill();

        this.makeLabel(text, 36, COLOR_TEXT_LIGHT, btn, Vec3.ZERO);

        // Graphics 已自动附带 UITransform，复用而非重复添加，避免运行时异常
        const transform = btn.getComponent(UITransform) || btn.addComponent(UITransform);
        transform.setContentSize(w, h);
        btn.on(Node.EventType.TOUCH_END, onClick, this);
    }

    /** 绘制圆角矩形路径 */
    private roundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
        r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
        g.roundRect(x, y, w, h, r);
    }
}
