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
    view, ResolutionPolicy, Tween, BlockInputEvents, Camera,
} from 'cc';
import {
    BoardLogic, Difficulty, DIFFICULTY_CONFIGS, Direction, MoveResult, BoardBuffs,
} from './BoardLogic';
import { SkinManager } from './SkinManager';
import { AdManager } from './AdManager';
import { TitleManager, BuffType } from './TitleManager';
import { DifficultyViewController } from './DifficultyViewController';
import { ResultViewController } from './ResultViewController';
import { ShopViewController } from './ShopViewController';
import { TitleViewController } from './TitleViewController';
import { BoardViewController } from './BoardViewController';
import { EconomyController } from './EconomyController';
import { TitleBuffService } from './TitleBuffService';
import { BuffRecordViewController } from './BuffRecordViewController';

const { ccclass, property } = _decorator;

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
const COLOR_TITLE_STATUS_BG = new Color(126, 76, 176);

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
    private shopView!: ShopViewController;
    private titleButton!: Node;
    private titleView!: TitleViewController;
    private titleStatusNode: Node | null = null;
    private titleStatusLabel: Label | null = null;
    private pageBackgroundNode: Node | null = null;
    private difficultyView!: DifficultyViewController;
    private resultView!: ResultViewController;
    private readonly buffService = new TitleBuffService();
    private readonly economy = new EconomyController(this.buffService);
    private hasRevivedThisGame = false;
    private energyShownRatio = 0;       // 当前显示的充能比例（0~1），用于平滑动画
    private energyTween: Tween<{ ratio: number }> | null = null;
    private energyPulseTween: Tween<UIOpacity> | null = null;
    private energyParticleLayer: Node | null = null;   // 持续粒子流承载节点
    private energyParticles: EnergyParticle[] = [];
    private undoButton: Node | null = null;
    private undoLabel: Label | null = null;
    private boardView!: BoardViewController;
    private buffRecordView!: BuffRecordViewController;

    private board!: BoardLogic;
    private isAnimating = false;
    private moveVersion = 0;
    private gameStarted = false;
    private bestScore = 0;
    private difficulty: Difficulty = 'easy';
    private touchStart: Vec2 | null = null;

    protected onLoad(): void {
        // 构建配置可能来自旧的 Creator 会话，这里再做一次运行时兜底，确保竖屏 UI 不会跑出视口。
        view.setDesignResolutionSize(720, 1280, ResolutionPolicy.SHOW_ALL);
        this.bindSceneUI();
        this.boardView = new BoardViewController(this.boardRoot);
        this.buffRecordView = new BuffRecordViewController(this.node);
        this.buffRecordView.setup();
        this.difficultyView = new DifficultyViewController({
            overlay: this.difficultyOverlay,
            panel: this.difficultyPanel,
            easyButton: this.easyButton,
            normalButton: this.normalButton,
            hardButton: this.hardButton,
            nightmareButton: this.nightmareButton,
        }, (difficulty) => this.selectDifficulty(difficulty));
        this.resultView = new ResultViewController({
            overlay: this.resultOverlay,
            panel: this.resultPanel,
            title: this.resultTitle,
            subtitle: this.resultSubtitle,
            restartButton: this.resultRestartButton,
        }, {
            onRestart: () => this.restart(),
            onRevive: () => this.reviveGame(),
            onDoubleCoin: () => this.doubleCoinGame(),
        });
        this.shopView = new ShopViewController(this.node, {
            onOpen: (overlay) => this.closeOtherOverlays(overlay),
            onClose: () => {
                if (!this.hasActiveModalOverlay()) AdManager.instance.hideBanner();
            },
            onSkinChanged: () => this.onSkinChanged(),
            onRewardedAdFailure: () => this.showRewardedAdFailureToast(),
        });
        this.titleView = new TitleViewController(this.node, {
            onOpen: (overlay) => this.closeOtherOverlays(overlay),
            onClose: () => {
                if (!this.hasActiveModalOverlay()) AdManager.instance.hideBanner();
            },
            onTitleEquipped: () => {
                if (this.board) {
                    this.board.updateBuffs(this.getEquippedBuffs());
                    this.updateUndoButton();
                }
                this.updateTitleStatusLabel();
            },
            onToast: (message, duration) => this.showToast(message, duration),
            onRewardedAdFailure: () => this.showRewardedAdFailureToast(),
        });
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
        this.buffRecordView?.clear();
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
        this.difficultyLabel.string = `难度：${DIFFICULTY_CONFIGS[this.difficulty].label}`;
        this.difficultyLabel.color = COLOR_TEXT_DARK;
        this.difficultyLabel.isBold = true;
        this.drawPanel(this.newGameButton, COLOR_BTN_BG, 10);
        this.drawBoardGraphics();
        this.updatePageTheme();
        this.drawEnergyBarBackground();
        this.initEnergyParticleLayer();
        this.difficultyView.setup();
        this.resultView.setup();
        this.updateEnergy(0, 100);

        this.createCoinUI();
        this.createAdEnergyButton();
        this.shopView.setup();
        this.createTitleButton();
        this.titleView.setup();
        // 提前预热称号配置加载（标题 UI 构建时即触发，避免进入面板后等待）
        TitleManager.instance.ensureLoadOnce();
        this.createTitleStatusUI();
        TitleManager.instance.whenReady(() => {
            if (this.node.isValid) this.updateTitleStatusLabel();
        });
    }

    private createTitleStatusUI(): void {
        let statusNode = this.node.getChildByName('TitleStatus');
        if (!statusNode) {
            statusNode = new Node('TitleStatus');
            statusNode.layer = Layers.Enum.UI_2D;
            statusNode.setPosition(0, 356, 5);
            this.node.addChild(statusNode);
            const transform = statusNode.addComponent(UITransform);
            transform.setContentSize(500, 28);
            this.drawPanel(statusNode, COLOR_TITLE_STATUS_BG, 8);

            const labelNode = new Node('Label');
            labelNode.layer = Layers.Enum.UI_2D;
            labelNode.setPosition(0, 0, 1);
            statusNode.addChild(labelNode);
            const labelTransform = labelNode.addComponent(UITransform);
            labelTransform.setContentSize(480, 28);
            const label = labelNode.addComponent(Label);
            label.fontSize = 16;
            label.lineHeight = 22;
            label.color = COLOR_TEXT_LIGHT;
            label.isBold = true;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            label.overflow = Label.Overflow.SHRINK;
            this.titleStatusLabel = label;
        } else {
            this.titleStatusLabel = statusNode.getChildByName('Label')?.getComponent(Label) || null;
        }
        this.titleStatusNode = statusNode;
        this.updateTitleStatusLabel();
    }

    /** 根据当前装备称号显示或隐藏状态条。 */
    private updateTitleStatusLabel(): void {
        if (!this.titleStatusNode || !this.titleStatusNode.isValid || !this.titleStatusLabel) return;
        const title = TitleManager.instance.getEquippedTitle();
        if (!title) {
            this.titleStatusNode.active = false;
            return;
        }

        this.titleStatusLabel.string = `${title.rarity} 称号【${title.name}】佩戴生效中`;
        this.titleStatusNode.active = true;
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
                    if (this.hasEquippedBuff(BuffType.UNDO_COUNT)) {
                        this.showTitleBuffTip(BuffType.UNDO_COUNT, '时间倒流！');
                    } else {
                        this.showToast('时间倒流！');
                    }
                    this.boardView.sync(this.board);
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
            label.fontSize = 20;
            label.lineHeight = 26;
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
            // 能量条位于棋盘正下方 (0, -330)，按钮紧随其下居中，与能量区成组便于点按
            adEnergyBtn.setPosition(0, -375, 0);
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
                } else if (!success) {
                    this.showRewardedAdFailureToast();
                }
            }, this);
        }
    }

    /** 尝试多种路径格式动态加载资源/图片 SpriteFrame。 */
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
                resources.load(`skin/${resName}`, Texture2D, (err3, texture) => {
                    if (!err3 && texture) {
                        const frame = new SpriteFrame();
                        frame.texture = texture;
                        callback(frame);
                        return;
                    }
                    callback(null);
                });
            });
        });
    }

    /** 短暂提示（Toast 风格），供普通操作和广告流程复用。 */
    private showToast(message: string, duration = 1500): void {
        const toast = new Node('Toast');
        toast.layer = Layers.Enum.UI_2D;
        toast.setPosition(0, 0, 0);
        this.node.addChild(toast);
        const background = toast.addComponent(Graphics);
        background.fillColor = new Color(0, 0, 0, 200);
        background.roundRect(-180, -30, 360, 60, 12);
        background.fill();
        this.makeLabel(message, 22, COLOR_TEXT_LIGHT, toast, Vec3.ZERO);
        this.scheduleOnce(() => {
            if (toast.isValid) toast.destroy();
        }, duration / 1000);
    }

    private showRewardedAdFailureToast(): void {
        this.showToast('广告加载失败，未发放奖励');
    }

    private openShop(): void {
        this.shopView.open();
    }

    private openTitle(): void {
        this.titleView.open();
    }

    private onSkinChanged(): void {
        this.updatePageTheme();
        this.drawBoardGraphics();
        this.boardView.renderAll();
        this.shopView.refresh();
    }

    /** 将当前皮肤的页面背景色同步到主相机。 */
    private updatePageTheme(): void {
        const color = SkinManager.instance.getPageBackgroundColor();
        let background = this.pageBackgroundNode;
        if (!background || !background.isValid) {
            background = this.node.getChildByName('ThemeBackground');
            if (!background) {
                background = new Node('ThemeBackground');
                background.layer = Layers.Enum.UI_2D;
                this.node.addChild(background);
                background.addComponent(UITransform);
                background.addComponent(Graphics);
            }
            this.pageBackgroundNode = background;
        }

        const transform = background.getComponent(UITransform);
        const graphics = background.getComponent(Graphics);
        if (transform && graphics) {
            transform.setContentSize(720, 1280);
            background.setPosition(0, 0, -100);
            graphics.clear();
            graphics.fillColor = color;
            graphics.rect(-360, -640, 720, 1280);
            graphics.fill();
            // 保证页面背景位于所有游戏 UI 和弹窗之后，不阻挡按钮触摸。
            background.setSiblingIndex(0);
        }

        const camera = this.node.parent?.getChildByName('Camera')?.getComponent(Camera);
        if (camera) camera.clearColor = color;
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
            cell.setPosition(this.boardView.cellPos(row, col));
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
            this.closeOtherOverlays(this.difficultyOverlay);
            this.difficultyView.show();
            this.resultView.hide();
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
        this.difficultyView.hide();
    }

    // ==================== 游戏流程 ====================

    private startGame(): void {
        AdManager.instance.hideBanner();
        this.moveVersion++;
        this.boardView.setCurrentVersion(this.moveVersion);
        this.isAnimating = false;
        this.economy.startGame();
        this.buffRecordView.clear();
        this.hasRevivedThisGame = false;
        this.board = new BoardLogic(4, this.difficulty, this.getEquippedBuffs()); // 构造函数 reset() 已生成 2 个方块
        this.gameStarted = true;
        if (this.board.initialBoostTriggered) {
            this.showTitleBuffTip(BuffType.INITIAL_BOOST, '开局升格生效：两个方块提升至 16');
        }
        if (this.hasEquippedBuff(BuffType.MIN_SPAWN_VALUE)) {
            const minValue = this.getEquippedBuffValue(BuffType.MIN_SPAWN_VALUE);
            this.showTitleBuffTip(BuffType.MIN_SPAWN_VALUE, `新方块保底为 ${Math.round(minValue)}`);
        }
        this.updateTitleStatusLabel();
        this.boardView.clear();
        // 渲染棋盘上所有已有方块（避免重复 spawn）
        for (let r = 0; r < 4; r++) {
            for (let c = 0; c < 4; c++) {
                const tile = this.board.grid[r][c];
                if (tile.value !== 0) {
                    this.boardView.addTile(r, c, tile);
                }
            }
        }
        this.updateScore();
        this.updateUndoButton();
    }

    private getEquippedBuffs(): BoardBuffs {
        return this.buffService.getBoardBuffs();
    }

    private hasEquippedBuff(type: BuffType): boolean {
        return this.buffService.has(type);
    }

    private getEquippedBuffValue(type: BuffType): number {
        return this.buffService.getValue(type);
    }

    private showTitleBuffTip(type: BuffType, detail: string): void {
        const title = TitleManager.instance.getEquippedTitle();
        if (!title || !this.buffService.has(type)) return;
        this.buffRecordView.show(`称号【${title.name}】${detail}`);
    }

    /** 将本次移动实际触发的称号 Buff 逐条写入右下角记录。 */
    private showTriggeredTitleBuffTips(
        result: MoveResult,
        spawnedPos: { row: number; col: number } | null,
    ): void {
        const title = TitleManager.instance.getEquippedTitle();
        const tips = this.buffService.getTriggeredTips(result, this.board, !!spawnedPos);
        if (!title) return;
        tips.forEach((tip) => this.buffRecordView.show(`【${title.name}】${tip}`));
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
        this.boardView.setCurrentVersion(moveVersion);
        let maxDur = 0;
        for (const move of result.moves) {
            const duration = this.boardView.animateMove(move, moveVersion);
            if (duration > maxDur) maxDur = duration;
        }

        const total = maxDur + 0.02;
        this.scheduleOnce(() => {
            if (moveVersion !== this.moveVersion) return;
            const explosionDuration = this.boardView.animateExplosions(result.explosions, moveVersion);
            this.scheduleOnce(() => {
                if (moveVersion !== this.moveVersion) return;
                const position = this.board.spawnTile();
                this.boardView.sync(this.board);
                this.showTriggeredTitleBuffTips(result, position);
                let extraCoins = 0;
                if (result.comboGoldBonus) {
                    extraCoins += result.comboGoldBonus;
                    this.buffRecordView.show('黄金点金手：连击金币 +' + result.comboGoldBonus);
                }
                if (result.goldDrops) {
                    extraCoins += result.goldDrops;
                    this.buffRecordView.show('无尽财阀：合成掉落金币 +' + result.goldDrops);
                }
                const winReward = this.board.consumeWin2048Reward();
                if (winReward > 0) {
                    extraCoins += winReward;
                    this.buffRecordView.show('创世主脑：达成2048奖励 +' + winReward);
                }
                if (extraCoins > 0) {
                    this.economy.addExtraCoins(extraCoins);
                    this.updateCoinsLabel();
                }
                if (result.chainTriggered) this.buffRecordView.show('裂变源点：十字爆破！');
                if (result.smallClearCount && result.smallClearCount > 0) this.buffRecordView.show(`超新星爆裂：清理 ${result.smallClearCount} 个杂块！`);
                if (result.gravityMerge) this.buffRecordView.show('灭世奇点：引力合并！');
                if (this.board.lastSpawnPaused) this.buffRecordView.show('绝对零度：停止生成！');
                if (this.board.lastAbsoluteDomain) this.buffRecordView.show('熵寂主宰：奇数同化！');
                this.updateScore();
                this.updateUndoButton();
                if (this.board.isGameOver()) {
                    if (this.board.tryGameOverPrevent()) {
                        this.showTitleBuffTip(BuffType.GAME_OVER_PREVENT, '时光倒流清杂！');
                        this.boardView.sync(this.board);
                        this.updateScore();
                    } else {
                        this.scheduleOnce(() => {
                            if (moveVersion === this.moveVersion) this.showOverlay('游戏结束', `得分 ${this.board.score}`, false);
                        }, 0.3);
                    }
                }
                this.isAnimating = false;
            }, explosionDuration + 0.02);
        }, total);
    }

    private updateScore(): void {
        this.economy.recordScore(this.board.score, this.difficulty);
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
        this.shopView?.updateCoinsLabel();
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

    private async reviveGame(): Promise<boolean> {
        const success = await AdManager.instance.showRewardedVideo('revive');
        if (!success) {
            this.showRewardedAdFailureToast();
            return false;
        }

        this.hasRevivedThisGame = true;
        const removed = this.board.removeSmallestTiles(5);
        this.boardView.removeTilesAt(removed);
        this.boardView.sync(this.board);
        return true;
    }

    private async doubleCoinGame(): Promise<boolean> {
        if (this.economy.getCoinsEarned() <= 0) return false;
        const success = await AdManager.instance.showRewardedVideo('double_coin');
        if (!success) {
            this.showRewardedAdFailureToast();
            return false;
        }

        this.economy.doubleReward();
        const snapshot = this.economy.getSnapshot();
        this.resultView.updateStats(
            this.board?.score || 0,
            snapshot.coinsEarned,
            snapshot.coinBonusEarned,
            snapshot.coinBonusRate,
        );
        this.updateCoinsLabel();
        return true;
    }

    private showOverlay(title: string, subtitle: string, isWin: boolean): void {
        if (this.resultOverlay.active) return;
        this.closeOtherOverlays(this.resultOverlay);
        const snapshot = this.economy.getSnapshot();
        this.resultView.updateStats(
            this.board?.score || 0,
            snapshot.coinsEarned,
            snapshot.coinBonusEarned,
            snapshot.coinBonusRate,
        );
        this.resultView.configureButtons(!isWin && !this.hasRevivedThisGame, snapshot.coinsEarned > 0);
        this.resultView.show(isWin ? '挑战完成' : '挑战结束');
    }

   private closeOverlay(): void {
        this.resultView.hide();
    }

    /** 保证同一时间只有一个弹窗可见，并将当前弹窗置于最上层。 */
    private closeOtherOverlays(activeOverlay: Node): void {
        const overlays = [
            this.shopView?.getOverlay(),
            this.titleView?.getOverlay(),
            this.difficultyOverlay,
            this.resultOverlay,
        ];
        overlays.forEach((overlay) => {
            if (overlay && overlay !== activeOverlay && overlay.isValid) {
                if (overlay === this.resultOverlay) {
                    this.resultView.hide();
                } else {
                    overlay.active = false;
                }
            }
        });
        activeOverlay.setSiblingIndex(this.node.children.length - 1);
    }

    private hasActiveModalOverlay(): boolean {
        return [
            this.shopView?.getOverlay(),
            this.titleView?.getOverlay(),
            this.difficultyOverlay,
            this.resultOverlay,
        ].some((overlay) => overlay && overlay.isValid && overlay.active);
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
        const trans = label.node.getComponent(UITransform);
        if (trans) trans.setContentSize(textWidth, label.lineHeight);
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
