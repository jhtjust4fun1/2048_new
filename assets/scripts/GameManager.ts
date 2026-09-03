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
    EventTouch, Vec2, UIOpacity, Layers, resources, SpriteFrame, Sprite, Texture2D,
    view, ResolutionPolicy, Tween, BlockInputEvents,
} from 'cc';
import {
    BoardLogic, Difficulty, DIFFICULTY_CONFIGS, Direction, ExplosionEvent,
    MoveResult, TileData, TileMove, BoardBuffs,
} from './BoardLogic';
import { SkinManager, SKIN_CONFIGS, SkinConfig } from './SkinManager';
import { AdManager } from './AdManager';
import { TitleManager, BuffType, TitleConfig, formatBuffText } from './TitleManager';

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

/** 能量条持续粒子流中的单个火花粒子 */
interface EnergyParticle {
    x: number;      // 相对能量条填充条节点的局部 x（px）
    y: number;      // 相对能量条填充条节点的局部 y（px）
    vx: number;     // 水平速度
    vy: number;     // 垂直速度
    size: number;   // 半径
    life: number;   // 剩余生命（秒）
    maxLife: number;
    golden: boolean; // 金色 / 橙色
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

    private coinLabel!: Label;
    private shopButton!: Node;
    private shopOverlay!: Node;
    private shopPanel!: Node;
    private shopCoinsLabel!: Label;
    private titleButton!: Node;
    private titleOverlay!: Node;
    private titlePanel!: Node;
    private lastScore = 0;
    private coinsEarnedThisGame = 0;
    private hasRevivedThisGame = false;
    private reviveButtonNode: Node | null = null;
    private doubleCoinButtonNode: Node | null = null;
    private energyShownRatio = 0;       // 当前显示的充能比例（0~1），用于平滑动画
    private energyTween: Tween<{ ratio: number }> | null = null;
    private energyPulseTween: Tween<UIOpacity> | null = null;
    private energyParticleLayer: Node | null = null;   // 持续粒子流承载节点
    private energyParticles: EnergyParticle[] = [];
    private undoButton: Node | null = null;
    private undoLabel: Label | null = null;

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
        this.newGameButton.on(Node.EventType.TOUCH_END, this.showDifficultySelection, this);
        if (this.shopButton) {
            this.shopButton.on(Node.EventType.TOUCH_END, this.openShop, this);
        }
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
            this.newGameButton.off(Node.EventType.TOUCH_END, this.showDifficultySelection, this);
        }
        if (this.resultRestartButton?.isValid) {
            this.resultRestartButton.off(Node.EventType.TOUCH_END, this.restart, this);
        }
        // 停止能量条充能动画，防止销毁后继续回调
        if (this.energyTween) { this.energyTween.stop(); this.energyTween = null; }
        if (this.energyPulseTween) { this.energyPulseTween.stop(); this.energyPulseTween = null; }
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
        this.addPanelTitle(this.scoreLabel.node.parent!, '当前');
        this.addPanelTitle(this.bestLabel.node.parent!, '最高');
        this.drawPanel(this.newGameButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.easyButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.normalButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.hardButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.nightmareButton, COLOR_BTN_BG, 10);
        this.drawPanel(this.resultRestartButton, COLOR_BTN_BG, 10);
        this.drawBoardGraphics();
        this.drawEnergyBarBackground();
        this.initEnergyParticleLayer();
        this.drawPanel(this.difficultyPanel, new Color(250, 248, 239), 14);
        this.drawPanel(this.resultPanel, new Color(250, 248, 239), 14);
        this.drawOverlayMask(this.difficultyOverlay);
        this.drawOverlayMask(this.resultOverlay);
        this.updateEnergy(0, 100);

        this.createCoinUI();
        this.createAdEnergyButton();
        this.buildShopOverlayUI();
        this.createTitleButton();
        this.buildTitleOverlayUI();
        // 提前预热称号配置加载（标题 UI 构建时即触发，避免进入面板后等待）
        TitleManager.instance.ensureLoadOnce();
    }

    private createCoinUI(): void {
        let coinPanel = this.node.getChildByName('CoinPanel');
        if (!coinPanel) {
            coinPanel = new Node('CoinPanel');
            coinPanel.layer = Layers.Enum.UI_2D;
            coinPanel.setPosition(-230, 565, 0);
            this.node.addChild(coinPanel);
            const transform = coinPanel.addComponent(UITransform);
            transform.setContentSize(160, 56);
            this.drawPanel(coinPanel, COLOR_PANEL_BG, 10);

            const titleNode = new Node('Title');
            titleNode.layer = Layers.Enum.UI_2D;
            titleNode.setPosition(0, 14, 0);
            coinPanel.addChild(titleNode);
            const titleLabel = titleNode.addComponent(Label);
            titleLabel.string = '金币';
            titleLabel.fontSize = 14;
            titleLabel.color = COLOR_TEXT_LIGHT;

            const valNode = new Node('Value');
            valNode.layer = Layers.Enum.UI_2D;
            valNode.setPosition(0, -10, 0);
            coinPanel.addChild(valNode);
            this.coinLabel = valNode.addComponent(Label);
            this.coinLabel.fontSize = 20;
            this.coinLabel.color = COLOR_TEXT_LIGHT;
        } else {
            this.coinLabel = coinPanel.getChildByName('Value')?.getComponent(Label)!;
        }

        let shopBtn = this.node.getChildByName('ShopButton');
        if (!shopBtn) {
            shopBtn = new Node('ShopButton');
            shopBtn.layer = Layers.Enum.UI_2D;
            shopBtn.setPosition(230, 565, 0);
            this.node.addChild(shopBtn);
            const transform = shopBtn.addComponent(UITransform);
            transform.setContentSize(120, 56);
            this.drawPanel(shopBtn, new Color(230, 140, 40), 10);

            const labelNode = new Node('Label');
            labelNode.layer = Layers.Enum.UI_2D;
            shopBtn.addChild(labelNode);
            const btnLabel = labelNode.addComponent(Label);
            btnLabel.string = '🎨 商店';
            btnLabel.fontSize = 20;
            btnLabel.color = COLOR_TEXT_LIGHT;

            this.shopButton = shopBtn;
            shopBtn.on(Node.EventType.TOUCH_END, this.openShop, this);
        } else {
            this.shopButton = shopBtn;
        }

        this.updateCoinsLabel();
        this.createUndoButton();
    }

    private createUndoButton(): void {
        let btn = this.node.getChildByName('UndoButton');
        if (!btn) {
            btn = new Node('UndoButton');
            btn.layer = Layers.Enum.UI_2D;
            btn.setPosition(0, -320, 0); // below board
            this.node.addChild(btn);
            const transform = btn.addComponent(UITransform);
            transform.setContentSize(160, 56);
            this.drawPanel(btn, new Color(130, 110, 160), 10);

            const labelNode = new Node('Label');
            labelNode.layer = Layers.Enum.UI_2D;
            btn.addChild(labelNode);
            const btnLabel = labelNode.addComponent(Label);
            btnLabel.string = '🔙 撤销 (0)';
            btnLabel.fontSize = 20;
            btnLabel.color = COLOR_TEXT_LIGHT;

            this.undoButton = btn;
            this.undoLabel = btnLabel;

            btn.on(Node.EventType.TOUCH_END, () => {
                if (!this.gameStarted || this.isAnimating) return;
                if (this.board && this.board.undo()) {
                    this.showToast('时间倒流！');
                    this.syncBoardUI();
                    this.updateScore();
                    this.updateEnergy(this.board.energy, this.board.maxEnergy);
                    this.updateUndoButton();
                } else {
                    this.showToast('无法撤销！');
                }
            }, this);
        } else {
            this.undoButton = btn;
            this.undoLabel = btn.getChildByName('Label')?.getComponent(Label)!;
        }
        this.undoButton.active = false;
    }

    private updateUndoButton(): void {
        if (!this.undoButton || !this.undoLabel || !this.board) return;
        const left = this.board.getUndoLeft();
        if (left > 0) {
            this.undoButton.active = true;
            this.undoLabel.string = `🔙 撤销 (${left})`;
        } else {
            this.undoButton.active = false;
        }
    }

    /** 创建顶部称号入口按钮（与商店按钮成组，位于其左侧） */
    private createTitleButton(): void {
        let titleBtn = this.node.getChildByName('TitleButton');
        if (!titleBtn) {
            titleBtn = new Node('TitleButton');
            titleBtn.layer = Layers.Enum.UI_2D;
            titleBtn.setPosition(100, 565, 0);
            this.node.addChild(titleBtn);
            const transform = titleBtn.addComponent(UITransform);
            transform.setContentSize(120, 56);
            this.drawPanel(titleBtn, new Color(150, 110, 220), 10);

            const labelNode = new Node('Label');
            labelNode.layer = Layers.Enum.UI_2D;
            titleBtn.addChild(labelNode);
            const btnLabel = labelNode.addComponent(Label);
            btnLabel.string = '🏆 称号';
            btnLabel.fontSize = 20;
            btnLabel.color = COLOR_TEXT_LIGHT;

            this.titleButton = titleBtn;
            titleBtn.on(Node.EventType.TOUCH_END, this.openTitle, this);
        } else {
            this.titleButton = titleBtn;
        }
    }

    private addPanelTitle(panel: Node, title: string): void {
        let titleNode = panel.getChildByName('Title');
        if (!titleNode) {
            titleNode = new Node('Title');
            titleNode.layer = Layers.Enum.UI_2D;
            titleNode.setPosition(0, 24, 0);
            panel.addChild(titleNode);
            const label = titleNode.addComponent(Label);
            label.string = title;
            label.fontSize = 14;
            label.lineHeight = 18;
            label.color = COLOR_TEXT_LIGHT;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
        }
        const valueNode = panel.getChildByName('Value');
        if (valueNode) {
            valueNode.setPosition(0, -20, 0);
        }
    }

    private createAdEnergyButton(): void {
        let adEnergyBtn = this.node.getChildByName('AdEnergyButton');
        if (!adEnergyBtn) {
            adEnergyBtn = new Node('AdEnergyButton');
            adEnergyBtn.layer = Layers.Enum.UI_2D;
            // 放置在能量条右侧
            adEnergyBtn.setPosition(250, 485, 0);
            this.node.addChild(adEnergyBtn);
            const transform = adEnergyBtn.addComponent(UITransform);
            transform.setContentSize(120, 40);
            this.drawPanel(adEnergyBtn, new Color(40, 160, 80), 8);

            const labelNode = new Node('Label');
            labelNode.layer = Layers.Enum.UI_2D;
            adEnergyBtn.addChild(labelNode);
            const btnLabel = labelNode.addComponent(Label);
            btnLabel.string = '⚡ 满能量';
            btnLabel.fontSize = 18;
            btnLabel.color = COLOR_TEXT_LIGHT;

            // 添加闪烁呼吸动画，吸引玩家点击
            const opacity = adEnergyBtn.addComponent(UIOpacity);
            tween(opacity)
                .repeatForever(
                    tween(opacity)
                        .to(0.8, { opacity: 150 })
                        .to(0.8, { opacity: 255 })
                )
                .start();

            adEnergyBtn.on(Node.EventType.TOUCH_END, async () => {
                // 如果游戏已经结束或能量已满，则不触发
                if (this.board && this.board.energy >= this.board.maxEnergy) return;
                
                const success = await AdManager.instance.showRewardedVideo('energy_refill');
                if (success && this.board) {
                    this.board.energy = this.board.maxEnergy;
                    this.updateEnergy(this.board.energy, this.board.maxEnergy);
                    // 满能量爆火花特效已经在 updateEnergy 中处理了
                }
            }, this);
        }
    }

    private buildShopOverlayUI(): void {
        if (this.shopOverlay && this.shopOverlay.isValid) return;

        this.shopOverlay = new Node('ShopOverlay');
        this.shopOverlay.layer = Layers.Enum.UI_2D;
        this.node.addChild(this.shopOverlay);
        const transform = this.shopOverlay.addComponent(UITransform);
        transform.setContentSize(720, 1280);
        this.shopOverlay.addComponent(UIOpacity);
        this.drawOverlayMask(this.shopOverlay);

        this.shopPanel = new Node('Panel');
        this.shopPanel.layer = Layers.Enum.UI_2D;
        this.shopOverlay.addChild(this.shopPanel);
        const panelTrans = this.shopPanel.addComponent(UITransform);
        panelTrans.setContentSize(640, 880);
        this.drawPanel(this.shopPanel, new Color(250, 248, 239), 16);

        this.makeLabel('格子皮肤商店', 36, COLOR_TEXT_DARK, this.shopPanel, new Vec3(0, 390, 0));

        const coinNode = new Node('ShopCoins');
        coinNode.layer = Layers.Enum.UI_2D;
        coinNode.setPosition(0, 335, 0);
        this.shopPanel.addChild(coinNode);
        this.shopCoinsLabel = coinNode.addComponent(Label);
        this.shopCoinsLabel.fontSize = 24;
        this.shopCoinsLabel.color = new Color(215, 140, 0);

        const closeBtn = new Node('CloseButton');
        closeBtn.layer = Layers.Enum.UI_2D;
        closeBtn.setPosition(270, 390, 0);
        this.shopPanel.addChild(closeBtn);
        const closeTrans = closeBtn.addComponent(UITransform);
        closeTrans.setContentSize(46, 46);
        this.drawPanel(closeBtn, new Color(214, 70, 48), 23);
        this.makeLabel('✕', 26, COLOR_TEXT_LIGHT, closeBtn, Vec3.ZERO);
        closeBtn.on(Node.EventType.TOUCH_END, () => {
            this.shopOverlay.active = false;
            if (!this.difficultyOverlay.active && !this.resultOverlay.active) {
                AdManager.instance.hideBanner();
            }
        }, this);

        this.refreshShopUI();
        this.shopOverlay.active = false;
    }

    /** 尝试多种路径格式动态加载资源/图片 SpriteFrame */
    private loadSkinSpriteFrame(resName: string, callback: (sf: SpriteFrame | null) => void): void {
        resources.load(`skin/${resName}/spriteFrame`, SpriteFrame, (err, sf) => {
            if (!err && sf) {
                callback(sf);
                return;
            }
            resources.load(`skin/${resName}`, SpriteFrame, (err2, sf2) => {
                if (!err2 && sf2) {
                    callback(sf2);
                    return;
                }
                resources.load(`skin/${resName}`, Texture2D, (err3, tex) => {
                    if (!err3 && tex) {
                        const frame = new SpriteFrame();
                        frame.texture = tex;
                        callback(frame);
                        return;
                    }
                    callback(null);
                });
            });
        });
    }

    private refreshShopUI(): void {
        if (!this.shopPanel) return;

        const oldCards = this.shopPanel.children.filter((child) => child.name.startsWith('SkinCard_'));
        oldCards.forEach((c) => c.destroy());

        this.updateCoinsLabel();

        const skins = SKIN_CONFIGS;
        const startY = 220;
        const cardHeight = 140;
        const gap = 15;

        skins.forEach((skin, index) => {
            const cardNode = new Node(`SkinCard_${skin.id}`);
            cardNode.layer = Layers.Enum.UI_2D;
            cardNode.setPosition(0, startY - index * (cardHeight + gap), 0);
            this.shopPanel.addChild(cardNode);

            const trans = cardNode.addComponent(UITransform);
            trans.setContentSize(580, cardHeight);

            const isEquipped = SkinManager.instance.getEquippedSkinId() === skin.id;
            const isUnlocked = SkinManager.instance.isSkinUnlocked(skin.id);

            // 背景卡片
            this.drawPanel(cardNode, isEquipped ? new Color(245, 235, 215) : new Color(238, 228, 218), 12);

            // ==================== 左侧皮肤预览区（纯色块主题） ====================
            const previewNode = new Node('SkinPreview');
            previewNode.layer = Layers.Enum.UI_2D;
            previewNode.setPosition(-220, 0, 0);
            cardNode.addChild(previewNode);

            const pTrans = previewNode.addComponent(UITransform);
            pTrans.setContentSize(90, 90);
            this.drawPanel(previewNode, skin.colors[0].bg, 10);

            // 不使用图片皮肤：预览区仅保留纯色块主题，显示皮肤名缩略字
            this.makeLabel(skin.name.substring(0, 2), 24, skin.colors[0].text, previewNode, Vec3.ZERO);

            // ==================== 中间信息区 ====================
            const nameLabel = this.makeLabel(skin.name, 24, COLOR_TEXT_DARK, cardNode, new Vec3(-140, 35, 0));
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;

            const descLabel = this.makeLabel(skin.description, 15, new Color(130, 120, 110), cardNode, new Vec3(-140, 5, 0));
            descLabel.horizontalAlign = Label.HorizontalAlign.LEFT;

            // 属性 Color 样例预览 (3个 24x24 小圆点)
            const sampleValues = [2, 8, 64];
            sampleValues.forEach((val, i) => {
                const sampleNode = new Node('SampleColor');
                sampleNode.layer = Layers.Enum.UI_2D;
                sampleNode.setPosition(-140 + i * 30, -32, 0);
                cardNode.addChild(sampleNode);

                const sampleTrans = sampleNode.addComponent(UITransform);
                sampleTrans.setContentSize(24, 24);

                const g = sampleNode.addComponent(Graphics);
                this.roundRect(g, -12, -12, 24, 24, 4);

                const colorIdx = Math.min(Math.floor(Math.log2(val)) - 1, skin.colors.length - 1);
                const style = skin.colors[colorIdx >= 0 ? colorIdx : 0];
                g.fillColor = style.bg;
                g.fill();
            });

            // ==================== 右侧操作按钮 ====================
            const btnNode = new Node('ActionButton');
            btnNode.layer = Layers.Enum.UI_2D;
            btnNode.setPosition(200, (skin.price >= 600 && !isUnlocked) ? 20 : 0, 0);
            cardNode.addChild(btnNode);

            const btnTrans = btnNode.addComponent(UITransform);
            btnTrans.setContentSize(130, 48);

            let btnBg = COLOR_BTN_BG;
            let btnText = '';

            if (isEquipped) {
                btnBg = new Color(120, 180, 90);
                btnText = '已使用';
            } else if (isUnlocked) {
                btnBg = new Color(242, 177, 121);
                btnText = '使用';
            } else {
                const canBuy = SkinManager.instance.getCoins() >= skin.price;
                btnBg = canBuy ? new Color(246, 124, 95) : new Color(180, 170, 160);
                btnText = `🪙 ${skin.price}`;
            }

            this.drawPanel(btnNode, btnBg, 8);
            this.makeLabel(btnText, 20, COLOR_TEXT_LIGHT, btnNode, Vec3.ZERO);

            if (!isEquipped) {
                btnNode.on(Node.EventType.TOUCH_END, () => {
                    if (isUnlocked) {
                        SkinManager.instance.equipSkin(skin.id);
                        this.onSkinChanged();
                    } else {
                        if (SkinManager.instance.buySkin(skin.id)) {
                            this.onSkinChanged();
                        }
                    }
                }, this);
            }

            // ==================== 广告解锁按钮 (史诗皮肤专属) ====================
            if (!isUnlocked && skin.price >= 600) {
                const adBtnNode = new Node('AdUnlockButton');
                adBtnNode.layer = Layers.Enum.UI_2D;
                adBtnNode.setPosition(200, -35, 0);
                cardNode.addChild(adBtnNode);

                const adBtnTrans = adBtnNode.addComponent(UITransform);
                adBtnTrans.setContentSize(130, 40);
                this.drawPanel(adBtnNode, new Color(100, 150, 240), 8);

                const adProgress = SkinManager.instance.getAdWatchedCount(skin.id);
                this.makeLabel(`🎬 解锁 (${adProgress}/5)`, 16, COLOR_TEXT_LIGHT, adBtnNode, Vec3.ZERO);

                adBtnNode.on(Node.EventType.TOUCH_END, async () => {
                    const success = await AdManager.instance.showRewardedVideo('shop_freebie');
                    if (success) {
                        const unlocked = SkinManager.instance.watchAdForSkin(skin.id);
                        if (unlocked) {
                            SkinManager.instance.equipSkin(skin.id);
                        }
                        this.onSkinChanged(); // 刷新商店与界面
                    }
                }, this);
            }
        });
    }

    private openShop(): void {
        if (!this.shopOverlay) return;
        this.refreshShopUI();
        this.shopOverlay.active = true;
        AdManager.instance.showBanner();
        const opacity = this.shopOverlay.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity).to(0.2, { opacity: 255 }).start();
        }
    }

    // ==================== 称号系统 ====================

    private titleTab: 'gacha' | 'inventory' | 'catalog' = 'gacha';
    /** 图鉴分页（每页 8 个称号） */
    private catalogPage = 0;
    private inventoryPage = 0;
    private titleContentContainer!: Node;

    private buildTitleOverlayUI(): void {
        if (this.titleOverlay && this.titleOverlay.isValid) return;

        this.titleOverlay = new Node('TitleOverlay');
        this.titleOverlay.layer = Layers.Enum.UI_2D;
        this.node.addChild(this.titleOverlay);
        const transform = this.titleOverlay.addComponent(UITransform);
        transform.setContentSize(720, 1280);
        this.titleOverlay.addComponent(UIOpacity);
        this.drawOverlayMask(this.titleOverlay);

        this.titlePanel = new Node('Panel');
        this.titlePanel.layer = Layers.Enum.UI_2D;
        this.titleOverlay.addChild(this.titlePanel);
        const panelTrans = this.titlePanel.addComponent(UITransform);
        panelTrans.setContentSize(640, 880);
        this.drawPanel(this.titlePanel, new Color(250, 248, 239), 16);

        this.makeLabel('称号系统', 36, COLOR_TEXT_DARK, this.titlePanel, new Vec3(0, 390, 0));

        const closeBtn = new Node('CloseButton');
        closeBtn.layer = Layers.Enum.UI_2D;
        closeBtn.setPosition(270, 390, 0);
        this.titlePanel.addChild(closeBtn);
        const closeTrans = closeBtn.addComponent(UITransform);
        closeTrans.setContentSize(46, 46);
        this.drawPanel(closeBtn, new Color(214, 70, 48), 23);
        this.makeLabel('✕', 26, COLOR_TEXT_LIGHT, closeBtn, Vec3.ZERO);
        closeBtn.on(Node.EventType.TOUCH_END, () => {
            this.titleOverlay.active = false;
            if (!this.difficultyOverlay.active && !this.resultOverlay.active) {
                AdManager.instance.hideBanner();
            }
        }, this);

        // 标签页：抽卡 / 背包
        const tabBar = new Node('TabBar');
        tabBar.layer = Layers.Enum.UI_2D;
        tabBar.setPosition(0, 340, 0);
        this.titlePanel.addChild(tabBar);

        const tabs = ['gacha', 'inventory', 'catalog'] as const;
        const tabLabels = ['🎴 抽卡', '🎒 背包', '📖 图鉴'];
        tabs.forEach((tab, i) => {
            const btn = new Node(`Tab_${tab}`);
            btn.layer = Layers.Enum.UI_2D;
            btn.setPosition(-190 + i * 190, 0, 0);
            tabBar.addChild(btn);
            const btnTrans = btn.addComponent(UITransform);
            btnTrans.setContentSize(180, 48);
            this.drawPanel(btn, new Color(220, 210, 200), 8);
            this.makeLabel(tabLabels[i], 22, COLOR_TEXT_DARK, btn, Vec3.ZERO);
            btn.on(Node.EventType.TOUCH_END, () => {
                this.titleTab = tab;
                this.refreshTitleUI();
            }, this);
        });

        // 内容容器（每次刷新时清空重建）
        this.titleContentContainer = new Node('ContentContainer');
        this.titleContentContainer.layer = Layers.Enum.UI_2D;
        this.titleContentContainer.setPosition(0, -30, 0);
        this.titlePanel.addChild(this.titleContentContainer);

        this.titleOverlay.active = false;
    }

    private refreshTitleUI(): void {
        if (!this.titleContentContainer || !this.titleContentContainer.isValid) return;
        // 清除旧内容
        this.titleContentContainer.children.forEach((c) => c.destroy());
        this.titleContentContainer.removeAllChildren();

        if (this.titleTab === 'gacha') {
            this.buildGachaTab();
        } else if (this.titleTab === 'inventory') {
            this.buildInventoryTab();
        } else {
            this.buildCatalogTab();
        }
    }

    private buildGachaTab(): void {
        const container = this.titleContentContainer;

        // 金币显示
        this.makeLabel(
            `🪙 ${SkinManager.instance.getCoins()}`,
            22,
            new Color(215, 140, 0),
            container,
            new Vec3(0, 280, 0),
        );

        // 广告免费抽剩余次数
        const freeLeft = TitleManager.instance.getFreeAdLeftToday();
        const freeHint = this.makeLabel(
            `📺 免费抽：今日剩余 ${freeLeft} / ${TitleManager.instance.dailyFreeAdLimit} 次`,
            18,
            new Color(160, 150, 140),
            container,
            new Vec3(0, 240, 0),
        );

        // 单抽按钮
        const singleBtn = new Node('SingleGacha');
        singleBtn.layer = Layers.Enum.UI_2D;
        singleBtn.setPosition(0, 180, 0);
        container.addChild(singleBtn);
        const singleTrans = singleBtn.addComponent(UITransform);
        singleTrans.setContentSize(200, 56);
        this.drawPanel(singleBtn, new Color(150, 110, 220), 10);
        this.makeLabel(`抽 1 次 (${TitleManager.instance.gachaPrice}🪙)`, 20, COLOR_TEXT_LIGHT, singleBtn, Vec3.ZERO);
        singleBtn.on(Node.EventType.TOUCH_END, () => {
            const result = TitleManager.instance.gachaOnce();
            if (result) {
                this.showGachaResult([result]);
                this.refreshTitleUI();
            } else {
                this.showToast('金币不足！');
            }
        }, this);

        // 免费广告抽按钮
        const freeBtn = new Node('FreeAdGacha');
        freeBtn.layer = Layers.Enum.UI_2D;
        freeBtn.setPosition(0, 110, 0);
        container.addChild(freeBtn);
        const freeTrans = freeBtn.addComponent(UITransform);
        freeTrans.setContentSize(200, 56);
        this.drawPanel(freeBtn, new Color(40, 160, 80), 10);
        this.makeLabel(freeLeft > 0 ? '🎬 免费广告抽' : '今日已用完', 20, COLOR_TEXT_LIGHT, freeBtn, Vec3.ZERO);
        freeBtn.on(Node.EventType.TOUCH_END, async () => {
            if (TitleManager.instance.getFreeAdLeftToday() <= 0) {
                this.showToast('今日免费次数已用完！');
                return;
            }
            const success = await AdManager.instance.showRewardedVideo('title_free_gacha');
            if (success) {
                const result = TitleManager.instance.gachaFreeAd();
                if (result) {
                    this.showGachaResult([result]);
                    this.refreshTitleUI();
                }
            }
        }, this);

        // 十连按钮
        const tenBtn = new Node('TenGacha');
        tenBtn.layer = Layers.Enum.UI_2D;
        tenBtn.setPosition(0, 40, 0);
        container.addChild(tenBtn);
        const tenTrans = tenBtn.addComponent(UITransform);
        tenTrans.setContentSize(200, 56);
        this.drawPanel(tenBtn, new Color(200, 120, 40), 10);
        this.makeLabel(`十连 (${TitleManager.instance.gachaPrice * TitleManager.instance.gachaTenCount}🪙)`, 20, COLOR_TEXT_LIGHT, tenBtn, Vec3.ZERO);
        tenBtn.on(Node.EventType.TOUCH_END, () => {
            const results = TitleManager.instance.gachaTen(false);
            if (results.length > 0) {
                this.showGachaResult(results);
                this.refreshTitleUI();
            } else {
                this.showToast('金币不足！');
            }
        }, this);

        // 广告十连半价按钮
        const adTenBtn = new Node('AdTenGacha');
        adTenBtn.layer = Layers.Enum.UI_2D;
        adTenBtn.setPosition(0, -30, 0);
        container.addChild(adTenBtn);
        const adTenTrans = adTenBtn.addComponent(UITransform);
        adTenTrans.setContentSize(200, 48);
        this.drawPanel(adTenBtn, new Color(60, 140, 60), 8);
        this.makeLabel('🎬 广告十连半价', 18, COLOR_TEXT_LIGHT, adTenBtn, Vec3.ZERO);
        adTenBtn.on(Node.EventType.TOUCH_END, async () => {
            const success = await AdManager.instance.showRewardedVideo('title_ten_half');
            if (success) {
                const results = TitleManager.instance.gachaTen(true);
                if (results.length > 0) {
                    this.showGachaResult(results);
                    this.refreshTitleUI();
                } else {
                    this.showToast('金币不足！');
                }
            }
        }, this);

        // 当前装备提示
        const equipped = TitleManager.instance.getEquippedTitle();
        if (equipped) {
            this.makeLabel(
                `当前装备：${equipped.name}`,
                18,
                new Color(100, 90, 80),
                container,
                new Vec3(0, -100, 0),
            );
        }
    }

    private buildInventoryTab(): void {
        const container = this.titleContentContainer;
        const items = TitleManager.instance.getInventory();
        const equippedId = TitleManager.instance.getEquippedTitleId();

        if (items.length === 0) {
            this.makeLabel('暂无称号，快去抽卡吧！', 22, new Color(150, 140, 130), container, new Vec3(0, 200, 0));
            return;
        }

        const pageSize = 6;
        const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
        this.inventoryPage = Math.max(0, Math.min(this.inventoryPage, pageCount - 1));
        const startIdx = this.inventoryPage * pageSize;
        const pageItems = items.slice(startIdx, startIdx + pageSize);

        this.makeLabel(`拥有称号（共 ${items.length} 种）`, 22, COLOR_TEXT_DARK, container, new Vec3(0, 300, 0));

        const startY = 230;
        const cardHeight = 85;
        const gap = 12;

        for (let i = 0; i < pageItems.length; i++) {
            const { config, count } = pageItems[i];
            const y = startY - i * (cardHeight + gap);
            const card = new Node(`TitleCard_${config.id}`);
            card.layer = Layers.Enum.UI_2D;
            card.setPosition(0, y, 0);
            container.addChild(card);
            const cardTrans = card.addComponent(UITransform);
            cardTrans.setContentSize(570, cardHeight);
            const isEquipped = config.id === equippedId;
            this.drawPanel(card, isEquipped ? new Color(235, 225, 210) : new Color(238, 228, 218), 10);

            const nameText = `${config.name} x${count}`;
            const nameLabel = this.makeLabel(nameText, 20, COLOR_TEXT_DARK, card, new Vec3(-240, 15, 0));
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(nameLabel, 450, -240);

            const rarityColors: Record<string, Color> = {
                N: new Color(158, 158, 158),
                R: new Color(74, 144, 217),
                SR: new Color(155, 89, 208),
                SSR: new Color(242, 179, 15),
                UR: new Color(227, 74, 74),
            };
            const rarityColor = rarityColors[config.rarity] || new Color(200, 190, 180);
            const rarityNode = new Node('RarityTag');
            rarityNode.layer = Layers.Enum.UI_2D;
            
            let nameWidth = 0;
            for (const ch of nameText) {
                nameWidth += ch.charCodeAt(0) > 255 ? 20 : 11;
            }
            const rarityX = Math.min(-240 + nameWidth + 8 + 30, 120);
            rarityNode.setPosition(rarityX, 15, 0);
            card.addChild(rarityNode);
            const rarityTrans = rarityNode.addComponent(UITransform);
            rarityTrans.setContentSize(60, 24);
            this.drawPanel(rarityNode, rarityColor, 6);
            this.makeLabel(config.rarity, 16, COLOR_TEXT_LIGHT, rarityNode, Vec3.ZERO);

            const buffLabel = this.makeLabel(
                `✨ ${formatBuffText(config.buffType, config.buffValue)}`,
                15,
                new Color(180, 110, 30),
                card,
                new Vec3(-240, -22, 0),
            );
            buffLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(buffLabel, 360, -240);

            if (!isEquipped) {
                const equipBtn = new Node('EquipBtn');
                equipBtn.layer = Layers.Enum.UI_2D;
                equipBtn.setPosition(230, 0, 0);
                card.addChild(equipBtn);
                const eqTrans = equipBtn.addComponent(UITransform);
                eqTrans.setContentSize(80, 40);
                this.drawPanel(equipBtn, new Color(100, 180, 100), 8);
                this.makeLabel('装备', 18, COLOR_TEXT_LIGHT, equipBtn, Vec3.ZERO);
                equipBtn.on(Node.EventType.TOUCH_END, () => {
                    TitleManager.instance.equipTitle(config.id);
                    if (this.board) {
                        this.board.updateBuffs(this.getEquippedBuffs());
                        this.updateUndoButton();
                    }
                    this.refreshTitleUI();
                }, this);
            } else {
                const unequipBtn = new Node('UnequipBtn');
                unequipBtn.layer = Layers.Enum.UI_2D;
                unequipBtn.setPosition(230, 0, 0);
                card.addChild(unequipBtn);
                const ueqTrans = unequipBtn.addComponent(UITransform);
                ueqTrans.setContentSize(80, 40);
                this.drawPanel(unequipBtn, new Color(180, 160, 140), 8);
                this.makeLabel('已装备', 18, COLOR_TEXT_LIGHT, unequipBtn, Vec3.ZERO);
            }

            if (config.rarity === 'SSR' && TitleManager.instance.canAscend(config.id)) {
                const ascendBtn = new Node('AscendBtn');
                ascendBtn.layer = Layers.Enum.UI_2D;
                ascendBtn.setPosition(130, 0, 0); // moved inside card to avoid overflow
                card.addChild(ascendBtn);
                const ascTrans = ascendBtn.addComponent(UITransform);
                ascTrans.setContentSize(80, 40);
                this.drawPanel(ascendBtn, new Color(240, 90, 90), 8);
                this.makeLabel('突破', 18, COLOR_TEXT_LIGHT, ascendBtn, Vec3.ZERO);
                ascendBtn.on(Node.EventType.TOUCH_END, () => {
                    const ur = TitleManager.instance.ascend(config.id);
                    if (ur) {
                        this.showToast(`🎉 合成成功！获得 ${ur.name}`);
                        this.refreshTitleUI();
                    }
                }, this);
            }
        }

        if (pageCount > 1) {
            const pageBtnY = startY - 6 * (cardHeight + gap) - 20; // 强制按满页计算，固定在底部

            const prevBtn = new Node('InventoryPrev');
            prevBtn.layer = Layers.Enum.UI_2D;
            prevBtn.setPosition(-130, pageBtnY, 0);
            container.addChild(prevBtn);
            const prevTrans = prevBtn.addComponent(UITransform);
            prevTrans.setContentSize(110, 40);
            this.drawPanel(prevBtn, new Color(200, 190, 180), 8);
            this.makeLabel('◀ 上一页', 18, COLOR_TEXT_DARK, prevBtn, Vec3.ZERO);
            prevBtn.on(Node.EventType.TOUCH_END, () => {
                if (this.inventoryPage > 0) {
                    this.inventoryPage--;
                    this.refreshTitleUI();
                }
            }, this);

            this.makeLabel(
                `${this.inventoryPage + 1} / ${pageCount}`,
                18,
                COLOR_TEXT_DARK,
                container,
                new Vec3(0, pageBtnY, 0),
            );

            const nextBtn = new Node('InventoryNext');
            nextBtn.layer = Layers.Enum.UI_2D;
            nextBtn.setPosition(130, pageBtnY, 0);
            container.addChild(nextBtn);
            const nextTrans = nextBtn.addComponent(UITransform);
            nextTrans.setContentSize(110, 40);
            this.drawPanel(nextBtn, new Color(200, 190, 180), 8);
            this.makeLabel('下一页 ▶', 18, COLOR_TEXT_DARK, nextBtn, Vec3.ZERO);
            nextBtn.on(Node.EventType.TOUCH_END, () => {
                if (this.inventoryPage < pageCount - 1) {
                    this.inventoryPage++;
                    this.refreshTitleUI();
                }
            }, this);
        }
    }
    private buildCatalogTab(): void {
        const container = this.titleContentContainer;

        const all = TitleManager.instance.getAllConfigs();
        // 按稀有度排序：N < R < SR < SSR < UR
        const rarityRank: Record<string, number> = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4 };
        all.sort((a, b) => (rarityRank[a.rarity] - rarityRank[b.rarity]) || a.id.localeCompare(b.id));

        const equippedId = TitleManager.instance.getEquippedTitleId();
        const pageSize = 6;
        const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
        this.catalogPage = Math.max(0, Math.min(this.catalogPage, pageCount - 1));
        const startIdx = this.catalogPage * pageSize;
        const pageTitles = all.slice(startIdx, startIdx + pageSize);

        const rarityColors: Record<string, Color> = {
            N: new Color(158, 158, 158),
            R: new Color(74, 144, 217),
            SR: new Color(155, 89, 208),
            SSR: new Color(242, 179, 15),
            UR: new Color(227, 74, 74),
        };

        // 标题栏：总览
        this.makeLabel(`称号图鉴（共 ${all.length} 个）`, 22, COLOR_TEXT_DARK, container, new Vec3(0, 300, 0));

        const startY = 250;
        const cardHeight = 88;
        const gap = 10;

        pageTitles.forEach((config, i) => {
            const y = startY - i * (cardHeight + gap);
            const card = new Node(`CatalogCard_${config.id}`);
            card.layer = Layers.Enum.UI_2D;
            card.setPosition(0, y, 0);
            container.addChild(card);
            const cardTrans = card.addComponent(UITransform);
            cardTrans.setContentSize(570, cardHeight);
            const isEquipped = config.id === equippedId;
            const ownedCount = TitleManager.instance.getOwnedCount(config.id);
            this.drawPanel(card, isEquipped ? new Color(235, 225, 210) : new Color(238, 228, 218), 10);

            // 第一行：名称 + 拥有数/装备标记
            const nameSuffix = isEquipped ? '（已装备）' : (ownedCount > 0 ? ` x${ownedCount}` : '');
            const nameLabel = this.makeLabel(`${config.name}${nameSuffix}`, 19, COLOR_TEXT_DARK, card, new Vec3(-240, 26, 0));
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(nameLabel, 450);

            // 稀有度色标
            const rarityColor = rarityColors[config.rarity] || new Color(200, 190, 180);
            const rarityNode = new Node('RarityTag');
            rarityNode.layer = Layers.Enum.UI_2D;
            rarityNode.setPosition(255, 26, 0);
            card.addChild(rarityNode);
            const rarityTrans = rarityNode.addComponent(UITransform);
            rarityTrans.setContentSize(56, 24);
            this.drawPanel(rarityNode, rarityColor, 6);
            this.makeLabel(config.rarity, 16, COLOR_TEXT_LIGHT, rarityNode, Vec3.ZERO);

            // 第二行：Buff 效果
            const buffLabel = this.makeLabel(
                `✨ ${formatBuffText(config.buffType, config.buffValue)}`,
                16,
                new Color(180, 110, 30),
                card,
                new Vec3(-240, -4, 0),
            );
            buffLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(buffLabel, 500);

            // 第三行：描述
            const descLabel = this.makeLabel(config.desc, 14, new Color(130, 120, 110), card, new Vec3(-240, -32, 0));
            descLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(descLabel, 500);
        });

        // 分页按钮
        if (pageCount > 1) {
            const pageBtnY = startY - 6 * (cardHeight + gap) - 20; // 强制按满页计算，固定在底部

            const prevBtn = new Node('CatalogPrev');
            prevBtn.layer = Layers.Enum.UI_2D;
            prevBtn.setPosition(-130, pageBtnY, 0);
            container.addChild(prevBtn);
            const prevTrans = prevBtn.addComponent(UITransform);
            prevTrans.setContentSize(110, 40);
            this.drawPanel(prevBtn, new Color(200, 190, 180), 8);
            this.makeLabel('◀ 上一页', 18, COLOR_TEXT_DARK, prevBtn, Vec3.ZERO);
            prevBtn.on(Node.EventType.TOUCH_END, () => {
                if (this.catalogPage > 0) {
                    this.catalogPage--;
                    this.refreshTitleUI();
                }
            }, this);

            this.makeLabel(
                `${this.catalogPage + 1} / ${pageCount}`,
                18,
                COLOR_TEXT_DARK,
                container,
                new Vec3(0, pageBtnY, 0),
            );

            const nextBtn = new Node('CatalogNext');
            nextBtn.layer = Layers.Enum.UI_2D;
            nextBtn.setPosition(130, pageBtnY, 0);
            container.addChild(nextBtn);
            const nextTrans = nextBtn.addComponent(UITransform);
            nextTrans.setContentSize(110, 40);
            this.drawPanel(nextBtn, new Color(200, 190, 180), 8);
            this.makeLabel('下一页 ▶', 18, COLOR_TEXT_DARK, nextBtn, Vec3.ZERO);
            nextBtn.on(Node.EventType.TOUCH_END, () => {
                if (this.catalogPage < pageCount - 1) {
                    this.catalogPage++;
                    this.refreshTitleUI();
                }
            }, this);
        }
    }

    /** 展示抽卡结果（Toast 风格） */
    private showGachaResult(titles: TitleConfig[]): void {
        // 简单提示：显示第一个结果
        if (titles.length === 0) return;
        const top = titles[0];
        const rarityColors: Record<string, string> = {
            N: '#9e9e9e',
            R: '#4a90d9',
            SR: '#9b59d0',
            SSR: '#f2b30f',
            UR: '#e34a4a',
        };
        const color = rarityColors[top.rarity] || '#ffffff';
        const summary = titles.length === 1
            ? `${top.name}`
            : `${top.name} 等 ${titles.length} 个称号`;
        this.showToast(`抽到：${summary}`, 2000);
    }

    /** 短暂提示（Toast 风格） */
    private showToast(msg: string, duration: number = 1500): void {
        const toast = new Node('Toast');
        toast.layer = Layers.Enum.UI_2D;
        toast.setPosition(0, 0, 0);
        (this.titleOverlay || this.node).addChild(toast);
        const bg = toast.addComponent(Graphics);
        bg.fillColor = new Color(0, 0, 0, 200);
        bg.roundRect(-180, -30, 360, 60, 12);
        bg.fill();
        this.makeLabel(msg, 22, COLOR_TEXT_LIGHT, toast, Vec3.ZERO);
        this.scheduleOnce(() => {
            if (toast.isValid) toast.destroy();
        }, duration / 1000);
    }

    private openTitle(): void {
        if (!this.titleOverlay) return;
        this.titleOverlay.active = true;
        AdManager.instance.showBanner();
        this.refreshTitleUI();
        // 配置加载完成后若有标签页已经打开，刷新一次保证数据完整
        TitleManager.instance.whenReady(() => {
            if (this.titleOverlay && this.titleOverlay.active && this.titleOverlay.isValid) {
                this.refreshTitleUI();
            }
        });
        const opacity = this.titleOverlay.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity).to(0.2, { opacity: 255 }).start();
        }
    }

    private onSkinChanged(): void {
        this.drawBoardGraphics();
        this.tileMap.forEach((tv) => this.renderTile(tv));
        this.refreshShopUI();
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
        node.addComponent(BlockInputEvents);
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
        const skin = SkinManager.instance.getEquippedSkin();
        const background = this.boardRoot.getComponent(Graphics) || this.boardRoot.addComponent(Graphics);
        if (background) {
            const half = BOARD_SIZE / 2;
            background.clear();
            this.roundRect(background, -half, -half, BOARD_SIZE, BOARD_SIZE, 12);
            background.fillColor = skin.boardBg;
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
            graphics.fillColor = skin.cellBg;
            graphics.fill();
        }
    }

    /** 绘制能量条底色并装配充能火花资源；填充部分由 updateEnergy 根据当前能量重绘。 */
    private drawEnergyBarBackground(): void {
        const graphics = this.energyBarBackground.getComponent(Graphics)
            || this.energyBarBackground.addComponent(Graphics);
        const transform = this.energyBarBackground.getComponent(UITransform);
        if (!graphics || !transform) return;

        graphics.clear();
        this.roundRect(graphics, -transform.width / 2, -transform.height / 2,
            transform.width, transform.height, transform.height / 2);
        graphics.fillColor = new Color(45, 35, 30);
        graphics.fill();

        // 挂载生成的 23KB 精炼充能火花背景，并运行无限循环流光充能动画
        this.loadSkinSpriteFrame('energy_spark', (sf) => {
            if (sf && this.energyBarBackground && this.energyBarBackground.isValid) {
                let sparkBg = this.energyBarBackground.getChildByName('SparkBg');
                if (!sparkBg) {
                    sparkBg = new Node('SparkBg');
                    sparkBg.layer = Layers.Enum.UI_2D;
                    sparkBg.setPosition(0, 0, -1);
                    this.energyBarBackground.addChild(sparkBg);
                    const t = sparkBg.addComponent(UITransform);
                    t.setContentSize(transform.width + 30, transform.height + 6);
                    const opacity = sparkBg.addComponent(UIOpacity);
                    opacity.opacity = 180;

                    // 开启持续横向流动与呼吸电感充能动画
                    tween(sparkBg)
                        .repeatForever(
                            tween(sparkBg)
                                .to(0.7, { position: new Vec3(-12, 0, -1), scale: new Vec3(1.04, 1.06, 1) })
                                .to(0.7, { position: new Vec3(12, 0, -1), scale: new Vec3(1.0, 1.0, 1) }),
                        )
                        .start();
                }
                let sprite = sparkBg.getComponent(Sprite) || sparkBg.addComponent(Sprite);
                sprite.spriteFrame = sf;
            }
        });
    }

    // ==================== 难度选择 ====================

    private showDifficultySelection(): void {
        this.runWithInterstitialTransition(() => {
            this.difficultyOverlay.active = true;
            this.resultOverlay.active = false;
            AdManager.instance.showBanner();
        });
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
        AdManager.instance.hideBanner();
        this.moveVersion++;
        this.isAnimating = false;
        this.coinsEarnedThisGame = 0;
        this.hasRevivedThisGame = false;
        this.board = new BoardLogic(4, this.difficulty, this.getEquippedBuffs()); // 构造函数 reset() 已生成 2 个方块
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
        this.updateUndoButton();
    }

    /**
     * 将当前装备称号的 Buff 映射为 BoardBuffs（不含 COIN_BONUS，后者在金币结算处单独处理）。
     */
    private getEquippedBuffs(): BoardBuffs {
        const buffs: BoardBuffs = {};
        const title = TitleManager.instance.getEquippedTitle();
        if (!title) return buffs;
        
        const allEffects = [{ type: title.buffType, value: title.buffValue }, ...(title.effects || [])];
        for (const effect of allEffects) {
            switch (effect.type) {
                case BuffType.SCORE_BONUS: buffs.scoreMultiplier = 1 + effect.value; break;
                case BuffType.BOMB_PROB: buffs.bombProb = effect.value; break;
                case BuffType.BOMB_RANGE: buffs.bombRangeExtra = effect.value; break;
                case BuffType.BOMB_SCORE_MULT: buffs.bombScoreMultiplier = effect.value; break;
                case BuffType.BOMB_NO_DESTROY: buffs.bombNoDestroyProb = effect.value; break;
                case BuffType.COMBO_GOLD_BONUS: buffs.comboGoldBonus = effect.value; break;
                case BuffType.MERGE_GOLD_DROP: buffs.mergeGoldDropProb = effect.value; break;
                case BuffType.GRAVITY_MERGE: buffs.gravityMerge = effect.value > 0; break;
                case BuffType.UNDO_COUNT: buffs.undoCount = effect.value; break;
                case BuffType.INITIAL_BOOST: buffs.initialBoost = effect.value > 0; break;
                case BuffType.CHAIN_EXPLOSION: buffs.chainExplosion = effect.value > 0; break;
                case BuffType.CLEAR_SMALL_TILES: buffs.clearSmallThreshold = effect.value; break;
                case BuffType.PAUSE_SPAWN: buffs.pauseSpawnUses = effect.value; break;
                case BuffType.ABSOLUTE_DOMAIN: buffs.absoluteDomainUses = effect.value; break;
                case BuffType.MIN_SPAWN_VALUE: buffs.minSpawnValue = effect.value; break;
                case BuffType.SPAWN_8_PROB: buffs.spawn8Prob = effect.value; break;
                case BuffType.WIN_2048_REWARD: buffs.win2048Reward = effect.value; break;
                case BuffType.COMBO_SCORE_MULT: buffs.comboScoreMultiplier = effect.value; break;
                case BuffType.GAME_OVER_PREVENT: buffs.gameOverPreventUses = effect.value; break;
                default: break;
            }
        }
        return buffs;
    }

    /** 获取当前装备称号的金币加成倍率（COIN_BONUS），无称号为 1.0 */
    private getEquippedCoinMultiplier(): number {
        const title = TitleManager.instance.getEquippedTitle();
        if (!title) return 1;
        const allEffects = [{ type: title.buffType, value: title.buffValue }, ...(title.effects || [])];
        let mult = 1;
        for (const effect of allEffects) {
            if (effect.type === BuffType.COIN_BONUS) {
                mult += effect.value;
            }
        }
        return mult;
    }

    private restart(): void {
        this.runWithInterstitialTransition(() => {
            this.closeOverlay();
            this.startGame();
        });    }

    private runWithInterstitialTransition(callback: () => void): void {
        if (AdManager.instance.shouldShowInterstitial()) {
            let toast = this.node.getChildByName('AdToast');
            if (!toast) {
                toast = new Node('AdToast');
                toast.layer = Layers.Enum.UI_2D;
                this.node.addChild(toast);
                const bg = toast.addComponent(Graphics);
                bg.fillColor = new Color(0, 0, 0, 220);
                this.roundRect(bg, -180, -40, 360, 80, 12);
                bg.fill();
                this.makeLabel('即将展示广告...', 24, COLOR_TEXT_LIGHT, toast, Vec3.ZERO);
            }
            toast.active = true;
            toast.setSiblingIndex(this.node.children.length - 1);
            
            this.scheduleOnce(() => {
                toast!.active = false;
                callback();
                AdManager.instance.showInterstitial();
            }, 1.0);
        } else {
            callback();
            AdManager.instance.showInterstitial(); // 让它累加计数器
        }
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

        const total = maxDur + 0.02;
        this.scheduleOnce(() => {
            if (moveVersion !== this.moveVersion) return;

            const explosionDuration = this.animateExplosions(result.explosions, moveVersion);
            this.scheduleOnce(() => {
                if (moveVersion !== this.moveVersion) return;

                const pos = this.board.spawnTile();
                this.syncBoardUI();
                
                let extraCoins = 0;
                if (result.comboGoldBonus) {
                    extraCoins += result.comboGoldBonus;
                    this.showToast('黄金点金手：连击金币 +'+result.comboGoldBonus);
                }
                if (result.goldDrops) {
                    extraCoins += result.goldDrops;
                    this.showToast('无尽财阀：合成掉落金币 +'+result.goldDrops);
                }
                
                const winReward = this.board.consumeWin2048Reward();
                if (winReward > 0) {
                    extraCoins += winReward;
                    this.showToast('创世主脑：达成2048奖励 +'+winReward);
                }

                if (extraCoins > 0) {
                    TitleManager.instance.addCoins(extraCoins);
                    this.updateCoinsLabel();
                }

                if (result.chainTriggered) this.showToast('裂变源点：十字爆破！');
                if (result.smallClearCount && result.smallClearCount > 0) this.showToast(`超新星爆裂：清理 ${result.smallClearCount} 个杂块！`);
                if (result.gravityMerge) this.showToast('灭世奇点：引力合并！');
                if (this.board.lastSpawnPaused) this.showToast('绝对零度：停止生成！');
                if (this.board.lastAbsoluteDomain) this.showToast('熵寂主宰：奇数同化！');

                this.updateScore();
                this.updateUndoButton(); // Ensure Undo UI is updated

                if (!this.won && this.board.hasWon()) {
                    this.won = true;
                    this.scheduleOnce(() => {
                        if (moveVersion === this.moveVersion) {
                            const target = DIFFICULTY_CONFIGS[this.difficulty].target;
                            this.showOverlay('你赢了！', `已达到 ${target}，继续滑动即可不断挑战`, true);
                        }
                    }, 0.3);
                } else if (this.board.isGameOver()) {
                    if (this.board.tryGameOverPrevent()) {
                        this.showToast('因果掌控者：时光倒流清杂！');
                        this.syncBoardUI();
                        this.updateScore();
                    } else {
                        this.scheduleOnce(() => {
                            if (moveVersion === this.moveVersion) {
                                this.showOverlay('游戏结束', `得分 ${this.board.score}`, false);
                            }
                        }, 0.3);
                    }
                }
                this.isAnimating = false;
            }, explosionDuration + 0.02);
        }, total);
    }

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
    private syncBoardUI(): void {
        const activeIds = new Set<number>();
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const tile = this.board.grid[r][c];
                if (tile.value !== 0) {
                    activeIds.add(tile.id);
                    const tv = this.tileMap.get(tile.id);
                    if (tv) {
                        tv.value = tile.value;
                        tv.isBomb = !!tile.isBomb;
                        tv.row = r;
                        tv.col = c;
                        tv.node.setPosition(this.cellPos(r, c));
                        this.renderTile(tv);
                    } else {
                        this.addTile(r, c, tile);
                    }
                }
            }
        }
        for (const [id, tv] of this.tileMap.entries()) {
            if (!activeIds.has(id)) {
                if (tv.node.isValid) tv.node.destroy();
                this.tileMap.delete(id);
            }
        }
    }

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
        const transform = tv.node.getComponent(UITransform);
        if (transform) {
            transform.setContentSize(cs, cs);
        }
    }

    private bombColor(): { bg: Color; text: Color } {
        return { bg: new Color(214, 70, 48), text: COLOR_TEXT_LIGHT };
    }

    private tileColor(value: number): { bg: Color; text: Color } {
        return SkinManager.instance.getTileStyle(value);
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
        const diffScore = this.board.score - this.lastScore;
        if (diffScore > 0) {
            const gainedCoins = SkinManager.instance.addCoinsFromScore(diffScore, this.difficulty);
            // 称号 COIN_BONUS 金币加成（结算加成，仅作用于本局额外收益）
            const multiplier = this.getEquippedCoinMultiplier();
            const bonusCoins = Math.floor(gainedCoins * (multiplier - 1));
            if (bonusCoins > 0) {
                SkinManager.instance.addCoins(bonusCoins);
            }
            this.coinsEarnedThisGame += gainedCoins + bonusCoins;
            this.lastScore = this.board.score;
        } else if (this.board.score === 0) {
            this.lastScore = 0;
        }
        this.scoreLabel.string = String(this.board.score);
        if (this.board.score > this.bestScore) {
            this.bestScore = this.board.score;
            sys.localStorage.setItem(this.bestScoreKey(), String(this.bestScore));
        }
        this.bestLabel.string = String(this.bestScore);
        this.updateEnergy(this.board.energy, this.board.maxEnergy);
        this.updateCoinsLabel();
    }

    private updateCoinsLabel(): void {
        if (this.coinLabel && this.coinLabel.isValid) {
            this.coinLabel.string = `🪙 ${SkinManager.instance.getCoins()}`;
        }
        if (this.shopCoinsLabel && this.shopCoinsLabel.isValid) {
            this.shopCoinsLabel.string = `当前金币: 🪙 ${SkinManager.instance.getCoins()}`;
        }
    }

    private updateEnergy(energy: number, maxEnergy: number): void {
        const target = maxEnergy > 0 ? Math.max(0, Math.min(1, energy / maxEnergy)) : 0;
        this.energyLabel.string = `能量 ${energy}/${maxEnergy}`;

        const isIncreasing = target > this.energyShownRatio;

        // 停止之前的充能动画，从当前显示比例平滑过渡到目标
        if (this.energyTween) {
            this.energyTween.stop();
            this.energyTween = null;
        }
        const from = this.energyShownRatio;
        const obj = { ratio: from };
        this.energyTween = tween(obj)
            .to(0.35, { ratio: target }, {
                onUpdate: () => {
                    this.energyShownRatio = obj.ratio;
                    this.redrawEnergyFill();

                    // 在平滑充能推进过程中，龙头不断吐出流光碰撞火花
                    if (isIncreasing && Math.random() < 0.45) {
                        const transform = this.energyBarFill.getComponent(UITransform);
                        if (transform) {
                            const headX = transform.width * this.energyShownRatio - transform.width * transform.anchorX;
                            this.spawnEnergySparks(new Vec3(headX, 0, 0), 4);
                        }
                    }
                },
            })
            .call(() => {
                this.energyShownRatio = target;
                this.redrawEnergyFill();
                this.energyTween = null;
                // 充能到达终点爆出一击流光火花
                if (isIncreasing) {
                    const transform = this.energyBarFill.getComponent(UITransform);
                    if (transform) {
                        const headX = transform.width * target - transform.width * transform.anchorX;
                        this.spawnEnergySparks(new Vec3(headX, 0, 0), 16);
                    }
                }
            })
            .start();

        // 满能量脉冲发光
        this.updateEnergyPulse(target >= 1);
    }

    /** 根据当前 energyShownRatio 重绘能量条填充 */
    private redrawEnergyFill(): void {
        const graphics = this.energyBarFill.getComponent(Graphics)
            || this.energyBarFill.addComponent(Graphics);
        const transform = this.energyBarFill.getComponent(UITransform);
        if (!graphics || !transform) return;

        graphics.clear();
        const fillWidth = transform.width * this.energyShownRatio;
        const leftX = -transform.width * transform.anchorX;
        const bottomY = -transform.height * transform.anchorY;
        this.roundRect(graphics, leftX, bottomY,
            fillWidth, transform.height, transform.height / 2);
        
        // 满能量使用炽热火花橙，平时使用亮金流光色
        graphics.fillColor = this.energyShownRatio >= 1 ? new Color(255, 94, 30) : new Color(255, 196, 40);
        graphics.fill();
    }

    /**
     * 在能量条前端生成蹦火花/电火花爆裂粒子动画
     */
    private spawnEnergySparks(pos: Vec3, count: number = 14): void {
        if (!this.energyBarFill) return;
        const total = count + Math.floor(Math.random() * 4);
        for (let i = 0; i < total; i++) {
            const p = new Node('SparkParticle');
            p.layer = Layers.Enum.UI_2D;
            p.setPosition(pos.clone());
            this.energyBarFill.addChild(p);

            const g = p.addComponent(Graphics);
            const radius = 2.0 + Math.random() * 3.0;
            g.circle(0, 0, radius);
            g.fillColor = i % 2 === 0
                ? new Color(255, 230, 90)  // 亮金色
                : new Color(255, 100, 30);  // 蹦火花火焰橙
            g.fill();

            // 四散冲出的随机速度与角度
            const angle = (Math.random() * Math.PI * 2);
            const dist = 16 + Math.random() * 32;
            const target = new Vec3(
                pos.x + Math.cos(angle) * dist,
                pos.y + Math.sin(angle) * dist,
                0,
            );
            const dur = 0.18 + Math.random() * 0.18;

            const op = p.addComponent(UIOpacity);
            op.opacity = 255;

            tween(p)
                .to(dur, { position: target, scale: new Vec3(0.2, 0.2, 1) })
                .call(() => p.destroy())
                .start();
            tween(op)
                .to(dur * 0.8, { opacity: 0 })
                .start();
        }
    }

    /** 满能量时脉冲发光与连续爆火花，不满时恢复不透明 */
    private updateEnergyPulse(full: boolean): void {
        if (this.energyPulseTween) {
            this.energyPulseTween.stop();
            this.energyPulseTween = null;
        }
        let opacity = this.energyBarFill.getComponent(UIOpacity);
        if (full) {
            if (!opacity) opacity = this.energyBarFill.addComponent(UIOpacity);
            opacity.opacity = 255;
            this.energyPulseTween = tween(opacity)
                .repeatForever(
                    tween(opacity)
                        .to(0.35, { opacity: 120 })
                        .call(() => {
                            const transform = this.energyBarFill.getComponent(UITransform);
                            if (transform) {
                                const headX = transform.width * (1 - transform.anchorX);
                                this.spawnEnergySparks(new Vec3(headX, 0, 0));
                            }
                        })
                        .to(0.35, { opacity: 255 }),
                )
                .start();
        } else if (opacity) {
            opacity.opacity = 255;
        }
    }

    /** 创建能量条持续粒子流承载节点，粒子用 Graphics 绘制，无需额外资源 */
    private initEnergyParticleLayer(): void {
        if (this.energyParticleLayer && this.energyParticleLayer.isValid) return;
        this.energyParticleLayer = new Node('EnergyParticleLayer');
        this.energyParticleLayer.layer = Layers.Enum.UI_2D;
        this.energyParticleLayer.setPosition(0, 0, 0);
        this.energyBarFill.addChild(this.energyParticleLayer);
        this.energyParticleLayer.addComponent(UITransform);
        this.energyParticleLayer.addComponent(Graphics);
    }

    /** 每帧驱动能量条持续粒子流：生成、移动、淡出、重绘 */
    protected update(dt: number): void {
        this.updateEnergyParticles(dt);
    }

    /** 维护能量条内的持续火花粒子流：数量随充能比例变化，粒子向上/向外飘散淡出 */
    private updateEnergyParticles(dt: number): void {
        if (!this.energyParticleLayer || !this.energyParticleLayer.isValid) return;
        const graphics = this.energyParticleLayer.getComponent(Graphics);
        const transform = this.energyBarFill.getComponent(UITransform);
        if (!graphics || !transform) return;

        // 粒子数量随充能比例变化：0（空）→ 30（满）
        const targetCount = Math.floor(this.energyShownRatio * 30);

        // 更新已有粒子：移动、衰减、淘汰
        const list = this.energyParticles;
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            p.life -= dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            // 粒子向上飘散（vy 为正，Cocos y 轴向上）
            if (p.life <= 0) {
                list.splice(i, 1);
            }
        }

        // 按目标数量补充新粒子
        while (list.length < targetCount) {
            const fillWidth = transform.width * this.energyShownRatio;
            const halfH = transform.height / 2;
            const golden = Math.random() < 0.6;
            list.push({
                // x 范围与填充条绘制的 roundRect(-width/2, ..., fillWidth, ...) 一致
                x: -transform.width / 2 + Math.random() * fillWidth,
                y: (Math.random() - 0.5) * 2 * halfH,
                vx: (Math.random() - 0.5) * 20,
                vy: 20 + Math.random() * 40,   // 向上飘
                size: 1.5 + Math.random() * 2.5,
                life: 0.5 + Math.random() * 0.6,
                maxLife: 1.1,
                golden,
            });
        }

        // 重绘所有粒子
        graphics.clear();
        for (const p of list) {
            const ratio = Math.max(0, Math.min(1, p.life / p.maxLife));
            const alpha = Math.floor(ratio * 255);
            graphics.fillColor = p.golden
                ? new Color(255, 214, 90, alpha)
                : new Color(255, 110, 30, alpha);
            graphics.circle(p.x, p.y, p.size);
            graphics.fill();
        }
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
        this.resultSubtitle.string = `${subtitle}\n本局获得: 🪙 ${this.coinsEarnedThisGame}`;
        
        this.buildResultAdButtons(!isWin && !this.hasRevivedThisGame);

        this.resultOverlay.active = true;
        const opacity = this.resultOverlay.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity).to(0.25, { opacity: 255 }).start();
        }
    }

    private buildResultAdButtons(showRevive: boolean): void {
        // 重开按钮挪到底部
        this.resultRestartButton.setPosition(0, -110, 0);

        // 初始化复活按钮
        if (!this.reviveButtonNode) {
            this.reviveButtonNode = new Node('ReviveButton');
            this.reviveButtonNode.layer = Layers.Enum.UI_2D;
            this.resultPanel.addChild(this.reviveButtonNode);
            const trans = this.reviveButtonNode.addComponent(UITransform);
            trans.setContentSize(200, 56);
            this.drawPanel(this.reviveButtonNode, new Color(240, 100, 80), 10);
            this.makeLabel('🎬 观看广告复活', 20, COLOR_TEXT_LIGHT, this.reviveButtonNode, Vec3.ZERO);
            
            this.reviveButtonNode.on(Node.EventType.TOUCH_END, async () => {
                const success = await AdManager.instance.showRewardedVideo('revive');
                if (success) {
                    this.hasRevivedThisGame = true;
                    this.closeOverlay();
                    const removed = this.board.removeSmallestTiles(5);
                    // 刷新视图：移除对应的UI节点
                    removed.forEach(pos => {
                        const tileId = this.board.grid[pos.row][pos.col].id;
                        // 因为 BoardLogic.removeSmallestTiles 直接把 grid 置空，没改 id。
                        // 这里我们通过遍历所有现存的 tile 视图找到对应的移除
                        this.tileMap.forEach((tv, id) => {
                            if (tv.node.position.equals(this.cellPos(pos.row, pos.col))) {
                                tv.node.destroy();
                                this.tileMap.delete(id);
                            }
                        });
                    });
                }
            }, this);
        }

        // 初始化三倍收益按钮
        if (!this.doubleCoinButtonNode) {
            this.doubleCoinButtonNode = new Node('DoubleCoinButton');
            this.doubleCoinButtonNode.layer = Layers.Enum.UI_2D;
            this.resultPanel.addChild(this.doubleCoinButtonNode);
            const trans = this.doubleCoinButtonNode.addComponent(UITransform);
            trans.setContentSize(200, 56);
            this.drawPanel(this.doubleCoinButtonNode, new Color(230, 150, 40), 10);
            this.makeLabel('🎬 收益 x3', 20, COLOR_TEXT_LIGHT, this.doubleCoinButtonNode, Vec3.ZERO);
            
            this.doubleCoinButtonNode.on(Node.EventType.TOUCH_END, async () => {
                if (this.doubleCoinButtonNode!.active && this.coinsEarnedThisGame > 0) {
                    const success = await AdManager.instance.showRewardedVideo('double_coin');
                    if (success) {
                        SkinManager.instance.addCoins(this.coinsEarnedThisGame * 2);
                        this.doubleCoinButtonNode!.active = false; // 隐藏防多次点击
                        this.resultSubtitle.string = this.resultSubtitle.string + '\n(已翻倍)';
                        this.updateCoinsLabel();
                    }
                }
            }, this);
        }

        // 控制显示
        this.reviveButtonNode.active = showRevive;
        this.doubleCoinButtonNode.active = this.coinsEarnedThisGame > 0;
        
        // 排列位置
        let startY = 30;
        if (this.reviveButtonNode.active) {
            this.reviveButtonNode.setPosition(0, startY, 0);
            startY -= 70;
        }
        if (this.doubleCoinButtonNode.active) {
            this.doubleCoinButtonNode.setPosition(0, startY, 0);
            startY -= 70;
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

    /**
     * 将卡片内左对齐 Label 限定在指定文本宽度内：
     * 设置 UITransform 宽度 + SHRINK，并把节点中心右移到指定左缘坐标，
     * 防止长文本溢出卡片右侧边界。
     * @param leftX 文本左缘在父节点中的 x 坐标（默认 -240，与图鉴卡片一致）
     */
    private clampLabelToCard(label: Label, textWidth: number, leftX = -240): void {
        const trans = label.node.getComponent(UITransform) || label.node.addComponent(UITransform);
        trans.setContentSize(textWidth, label.lineHeight);
        label.overflow = Label.Overflow.SHRINK;
        const pos = label.node.position;
        // 调用方传入的 x 是原左缘坐标（当前节点锚点 0.5），把中心移到 leftX + width/2 使左缘对齐
        label.node.setPosition(leftX + textWidth / 2, pos.y, pos.z);
    }

    /** 绘制圆角矩形路径 */
    private roundRect(g: Graphics, x: number, y: number, w: number, h: number, r: number): void {
        r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
        g.roundRect(x, y, w, h, r);
    }
}
