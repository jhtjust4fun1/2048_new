import {
    BlockInputEvents, Color, Graphics, Label, Layers, Node, tween, UITransform, UIOpacity, Vec3,
} from 'cc';

const TEXT_LIGHT = new Color(249, 246, 242);
const RESULT_BG = new Color(24, 43, 67);
const RESULT_CARD = new Color(48, 69, 88);
const RESULT_YELLOW = new Color(255, 214, 0);
const RESULT_MUTED = new Color(188, 194, 201);
const RESULT_BUTTON_PINK = new Color(255, 48, 104);
const RESULT_BUTTON_DARK = new Color(48, 48, 48);

export interface ResultViewRefs {
    overlay: Node;
    panel: Node;
    title: Label;
    subtitle: Label;
    restartButton: Node;
}

export interface ResultViewCallbacks {
    onRestart: () => void;
    onRevive: () => Promise<boolean>;
    onDoubleCoin: () => Promise<boolean>;
}

export class ResultViewController {
    private readonly refs: ResultViewRefs;
    private readonly callbacks: ResultViewCallbacks;
    private scoreLabel: Label | null = null;
    private coinsLabel: Label | null = null;
    private coinBuffLabel: Label | null = null;
    private reviveButton: Node | null = null;
    private doubleCoinButton: Node | null = null;
    private readonly coveredSiblingStates = new Map<Node, boolean>();

    public constructor(refs: ResultViewRefs, callbacks: ResultViewCallbacks) {
        this.refs = refs;
        this.callbacks = callbacks;
    }

    public setup(): void {
        this.drawOverlay();
        this.preparePanel();
        this.prepareRestartButton();
        this.createStatLabels();
        this.createAdButtons();
        this.refs.overlay.active = false;
    }

    public show(title: string): void {
        this.refs.title.string = title;
        this.coverSiblingViews();
        this.refs.overlay.active = true;
        const parent = this.refs.overlay.parent;
        if (parent) this.refs.overlay.setSiblingIndex(parent.children.length - 1);
        const opacity = this.refs.overlay.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity).to(0.25, { opacity: 255 }).start();
        }
    }

    public hide(): void {
        this.refs.overlay.active = false;
        this.restoreSiblingViews();
    }

    public updateStats(score: number, coins: number, coinBonus: number, coinBonusRate: number): void {
        if (this.scoreLabel) this.scoreLabel.string = this.formatNumber(score);
        if (this.coinsLabel) this.coinsLabel.string = `+ ${this.formatNumber(coins)}`;
        if (this.coinBuffLabel) {
            const rate = coinBonusRate > 0 ? `（+${Math.round(coinBonusRate * 100)}%）` : '';
            this.coinBuffLabel.string = coinBonusRate > 0
                ? `称号加成 +${this.formatNumber(coinBonus)} 金币${rate}`
                : '';
            this.coinBuffLabel.node.active = coinBonusRate > 0;
        }
    }

    public configureButtons(showRevive: boolean, showDoubleCoin: boolean): void {
        if (!this.reviveButton || !this.doubleCoinButton) return;
        this.reviveButton.active = showRevive;
        this.doubleCoinButton.active = showDoubleCoin;
        this.styleButton(this.reviveButton, '▶ 观看广告复活', RESULT_BUTTON_PINK, RESULT_BUTTON_PINK);
        this.styleButton(this.doubleCoinButton, '▶ 收益 x3', RESULT_BUTTON_PINK, RESULT_BUTTON_PINK);
        this.styleButton(this.refs.restartButton, '再来一局', RESULT_BUTTON_DARK, new Color(105, 105, 105));

        const buttons: Node[] = [];
        if (showRevive) buttons.push(this.reviveButton);
        if (showDoubleCoin) buttons.push(this.doubleCoinButton);
        buttons.push(this.refs.restartButton);
        buttons.forEach((button, index) => button.setPosition(0, -210 - index * 84, 0));
    }

    private drawOverlay(): void {
        const graphics = this.refs.overlay.getComponent(Graphics) || this.refs.overlay.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = RESULT_BG;
        graphics.rect(-360, -640, 720, 1280);
        graphics.fill();
        this.refs.overlay.getComponent(BlockInputEvents) || this.refs.overlay.addComponent(BlockInputEvents);
    }

    private coverSiblingViews(): void {
        const parent = this.refs.overlay.parent;
        if (!parent || this.coveredSiblingStates.size > 0) return;
        for (const sibling of parent.children) {
            if (sibling === this.refs.overlay) continue;
            this.coveredSiblingStates.set(sibling, sibling.active);
            sibling.active = false;
        }
    }

    private restoreSiblingViews(): void {
        this.coveredSiblingStates.forEach((active, sibling) => {
            if (sibling.isValid) sibling.active = active;
        });
        this.coveredSiblingStates.clear();
    }

    private preparePanel(): void {
        this.refs.panel.setPosition(0, 100, 0);
        const transform = this.refs.panel.getComponent(UITransform);
        if (!transform) return;
        transform.setContentSize(560, 450);
        const graphics = this.refs.panel.getComponent(Graphics) || this.refs.panel.addComponent(Graphics);
        graphics.clear();
        graphics.roundRect(-280, -225, 560, 450, 30);
        graphics.fillColor = RESULT_CARD;
        graphics.fill();
        graphics.lineWidth = 5;
        graphics.strokeColor = RESULT_YELLOW;
        graphics.roundRect(-280, -225, 560, 450, 30);
        graphics.stroke();

        this.refs.title.node.setPosition(0, 340, 0);
        const titleTransform = this.refs.title.node.getComponent(UITransform);
        if (titleTransform) titleTransform.setContentSize(640, 100);
        this.refs.title.fontSize = 72;
        this.refs.title.lineHeight = 84;
        this.refs.title.color = RESULT_YELLOW;
        this.refs.title.isBold = true;
        this.refs.title.overflow = Label.Overflow.SHRINK;
        this.refs.subtitle.node.active = false;
    }

    private prepareRestartButton(): void {
        const rootLabel = this.refs.restartButton.getComponent(Label);
        if (rootLabel) {
            const labelNode = new Node('Label');
            labelNode.layer = this.refs.restartButton.layer;
            labelNode.setPosition(0, 0, 1);
            this.refs.restartButton.addChild(labelNode);
            const label = labelNode.addComponent(Label);
            label.string = rootLabel.string || '再来一局';
            label.fontSize = rootLabel.fontSize;
            label.lineHeight = Math.round(rootLabel.fontSize * 1.3);
            label.color = rootLabel.color.clone();
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            this.refs.restartButton.removeComponent(rootLabel);
        }
        this.refs.restartButton.removeFromParent();
        this.refs.overlay.addChild(this.refs.restartButton);
        this.refs.restartButton.on(Node.EventType.TOUCH_END, this.callbacks.onRestart, this);
    }

    private createStatLabels(): void {
        this.createLabel('本局最终得分', 28, RESULT_MUTED, new Vec3(0, 145, 0), 'ResultScoreCaption');
        this.scoreLabel = this.createLabel('0', 72, TEXT_LIGHT, new Vec3(0, 72, 0), 'ResultScoreValue');
        const divider = new Node('ResultDivider');
        divider.layer = Layers.Enum.UI_2D;
        divider.setPosition(0, 5, 0);
        this.refs.panel.addChild(divider);
        const dividerTransform = divider.addComponent(UITransform);
        dividerTransform.setContentSize(400, 2);
        const dividerGraphics = divider.addComponent(Graphics);
        dividerGraphics.fillColor = new Color(112, 91, 57);
        dividerGraphics.rect(-200, -1, 400, 2);
        dividerGraphics.fill();
        this.createLabel('结算获得金币', 28, RESULT_MUTED, new Vec3(0, -72, 0), 'ResultCoinsCaption');
        this.coinsLabel = this.createLabel('+ 0', 64, RESULT_YELLOW, new Vec3(0, -145, 0), 'ResultCoinsValue');
        this.coinBuffLabel = this.createLabel('', 22, RESULT_YELLOW, new Vec3(0, -195, 0), 'ResultCoinBuffValue');
        this.coinBuffLabel.node.active = false;
    }

    private createAdButtons(): void {
        this.reviveButton = this.createButton('ReviveButton', '▶ 观看广告复活', () => this.handleRevive());
        this.doubleCoinButton = this.createButton('DoubleCoinButton', '▶ 收益 x3', () => this.handleDoubleCoin());
        this.reviveButton.active = false;
        this.doubleCoinButton.active = false;
    }

    private createButton(name: string, text: string, onClick: () => Promise<void>): Node {
        const button = new Node(name);
        button.layer = Layers.Enum.UI_2D;
        this.refs.overlay.addChild(button);
        const transform = button.addComponent(UITransform);
        transform.setContentSize(400, 66);
        const labelNode = new Node('Label');
        labelNode.layer = Layers.Enum.UI_2D;
        button.addChild(labelNode);
        const label = labelNode.addComponent(Label);
        label.string = text;
        label.fontSize = 28;
        label.lineHeight = 36;
        label.color = TEXT_LIGHT;
        label.isBold = true;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        const labelTransform = labelNode.getComponent(UITransform);
        if (labelTransform) labelTransform.setContentSize(380, 58);
        button.on(Node.EventType.TOUCH_END, onClick, this);
        return button;
    }

    private async handleRevive(): Promise<void> {
        if (!this.reviveButton?.active) return;
        if (await this.callbacks.onRevive()) this.hide();
    }

    private async handleDoubleCoin(): Promise<void> {
        if (!this.doubleCoinButton?.active) return;
        if (await this.callbacks.onDoubleCoin()) this.doubleCoinButton.active = false;
    }

    private styleButton(button: Node, text: string, fillColor: Color, borderColor: Color): void {
        const transform = button.getComponent(UITransform);
        if (!transform) return;
        transform.setContentSize(400, 66);
        let background = button.getChildByName('__PanelBackground');
        if (!background) {
            background = new Node('__PanelBackground');
            background.layer = button.layer;
            background.setPosition(0, 0, -1);
            button.addChild(background);
        }
        background.setSiblingIndex(0);
        const backgroundTransform = background.getComponent(UITransform) || background.addComponent(UITransform);
        backgroundTransform.setContentSize(transform.width, transform.height);
        const graphics = background.getComponent(Graphics) || background.addComponent(Graphics);
        graphics.clear();
        graphics.roundRect(-200, -33, 400, 66, 33);
        graphics.fillColor = fillColor;
        graphics.fill();
        graphics.lineWidth = 4;
        graphics.strokeColor = borderColor;
        graphics.roundRect(-200, -33, 400, 66, 33);
        graphics.stroke();
        button.getComponent(BlockInputEvents) || button.addComponent(BlockInputEvents);
        const label = button.getChildByName('Label')?.getComponent(Label) || button.getComponent(Label);
        if (label) {
            label.string = text;
            label.fontSize = 28;
            label.lineHeight = 36;
            label.color = TEXT_LIGHT;
            label.isBold = true;
            label.horizontalAlign = Label.HorizontalAlign.CENTER;
            label.verticalAlign = Label.VerticalAlign.CENTER;
            const labelTransform = label.node.getComponent(UITransform);
            if (labelTransform) labelTransform.setContentSize(380, 58);
            if (label.node !== button) label.node.setSiblingIndex(button.children.length - 1);
        }
    }

    private createLabel(text: string, fontSize: number, color: Color, pos: Vec3, name: string): Label {
        const node = new Node(name);
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(pos);
        this.refs.panel.addChild(node);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(500, Math.max(40, fontSize * 1.3));
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.2);
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }

    private formatNumber(value: number): string {
        return Math.max(0, Math.floor(value)).toLocaleString('en-US');
    }
}
