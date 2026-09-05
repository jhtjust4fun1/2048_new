import {
    BlockInputEvents, Color, Graphics, Label, Layers, Node, tween, UITransform, UIOpacity, Vec3,
} from 'cc';
import { AdManager } from './AdManager';
import { SKIN_CONFIGS, SkinManager } from './SkinManager';

const COLOR_BTN_BG = new Color(143, 122, 102);
const COLOR_TEXT_DARK = new Color(119, 110, 101);
const COLOR_TEXT_LIGHT = new Color(249, 246, 242);
const COLOR_MASK = new Color(0, 0, 0, 160);

export interface ShopViewCallbacks {
    onOpen: (overlay: Node) => void;
    onClose: () => void;
    onSkinChanged: () => void;
    onRewardedAdFailure: () => void;
}

/** 运行时生成的皮肤商店页面。只处理 UI，皮肤数据和业务通过 SkinManager/回调完成。 */
export class ShopViewController {
    private readonly parent: Node;
    private readonly callbacks: ShopViewCallbacks;
    private overlay: Node | null = null;
    private panel: Node | null = null;
    private coinsLabel: Label | null = null;

    public constructor(parent: Node, callbacks: ShopViewCallbacks) {
        this.parent = parent;
        this.callbacks = callbacks;
    }

    public getOverlay(): Node | null {
        return this.overlay;
    }

    public setup(): void {
        if (this.overlay && this.overlay.isValid) return;

        const overlay = new Node('ShopOverlay');
        overlay.layer = Layers.Enum.UI_2D;
        this.parent.addChild(overlay);
        const transform = overlay.addComponent(UITransform);
        transform.setContentSize(720, 1280);
        overlay.addComponent(UIOpacity);
        this.drawOverlayMask(overlay);

        const panel = new Node('Panel');
        panel.layer = Layers.Enum.UI_2D;
        overlay.addChild(panel);
        const panelTrans = panel.addComponent(UITransform);
        panelTrans.setContentSize(640, 880);
        this.drawPanel(panel, new Color(250, 248, 239), 16);
        this.makeLabel('格子皮肤商店', 36, COLOR_TEXT_DARK, panel, new Vec3(0, 390, 0));

        const coinNode = new Node('ShopCoins');
        coinNode.layer = Layers.Enum.UI_2D;
        coinNode.setPosition(0, 335, 0);
        panel.addChild(coinNode);
        this.coinsLabel = coinNode.addComponent(Label);
        this.coinsLabel.fontSize = 24;
        this.coinsLabel.color = new Color(215, 140, 0);

        const closeBtn = new Node('CloseButton');
        closeBtn.layer = Layers.Enum.UI_2D;
        closeBtn.setPosition(270, 390, 0);
        panel.addChild(closeBtn);
        const closeTrans = closeBtn.addComponent(UITransform);
        closeTrans.setContentSize(46, 46);
        this.drawPanel(closeBtn, new Color(214, 70, 48), 23);
        this.makeLabel('✕', 26, COLOR_TEXT_LIGHT, closeBtn, Vec3.ZERO);
        closeBtn.on(Node.EventType.TOUCH_END, () => this.close(), this);

        this.overlay = overlay;
        this.panel = panel;
        this.refresh();
        this.overlay.active = false;
    }

    public open(): void {
        if (!this.overlay) return;
        this.callbacks.onOpen(this.overlay);
        this.refresh();
        this.overlay.active = true;
        AdManager.instance.showBanner();
        const opacity = this.overlay.getComponent(UIOpacity);
        if (opacity) {
            opacity.opacity = 0;
            tween(opacity).to(0.2, { opacity: 255 }).start();
        }
    }

    public close(): void {
        if (!this.overlay) return;
        this.overlay.active = false;
        this.callbacks.onClose();
    }

    public refresh(): void {
        if (!this.panel) return;

        const oldCards = this.panel.children.filter((child) => child.name.startsWith('SkinCard_'));
        oldCards.forEach((child) => child.destroy());
        this.updateCoinsLabel();

        const startY = 220;
        const cardHeight = 140;
        const gap = 15;

        SKIN_CONFIGS.forEach((skin, index) => {
            const cardNode = new Node(`SkinCard_${skin.id}`);
            cardNode.layer = Layers.Enum.UI_2D;
            cardNode.setPosition(0, startY - index * (cardHeight + gap), 0);
            this.panel!.addChild(cardNode);

            const trans = cardNode.addComponent(UITransform);
            trans.setContentSize(580, cardHeight);

            const isEquipped = SkinManager.instance.getEquippedSkinId() === skin.id;
            const isUnlocked = SkinManager.instance.isSkinUnlocked(skin.id);
            this.drawPanel(cardNode, isEquipped ? new Color(245, 235, 215) : new Color(238, 228, 218), 12);

            const previewNode = new Node('SkinPreview');
            previewNode.layer = Layers.Enum.UI_2D;
            previewNode.setPosition(-220, 0, 0);
            cardNode.addChild(previewNode);
            const previewTrans = previewNode.addComponent(UITransform);
            previewTrans.setContentSize(90, 90);
            this.drawPanel(previewNode, skin.colors[0].bg, 10);
            this.makeLabel(skin.name.substring(0, 2), 24, skin.colors[0].text, previewNode, Vec3.ZERO);

            const nameLabel = this.makeLabel(skin.name, 24, COLOR_TEXT_DARK, cardNode, new Vec3(-140, 35, 0));
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(nameLabel, 430, -140);

            const descLabel = this.makeLabel(skin.description, 15, new Color(130, 120, 110), cardNode, new Vec3(-140, 5, 0));
            descLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(descLabel, 430, -140);

            [2, 8, 64].forEach((value, sampleIndex) => {
                const sampleNode = new Node('SampleColor');
                sampleNode.layer = Layers.Enum.UI_2D;
                sampleNode.setPosition(-140 + sampleIndex * 30, -32, 0);
                cardNode.addChild(sampleNode);
                const sampleTrans = sampleNode.addComponent(UITransform);
                sampleTrans.setContentSize(24, 24);
                const graphics = sampleNode.addComponent(Graphics);
                this.roundRect(graphics, -12, -12, 24, 24, 4);
                const colorIndex = Math.min(Math.floor(Math.log2(value)) - 1, skin.colors.length - 1);
                graphics.fillColor = skin.colors[colorIndex >= 0 ? colorIndex : 0].bg;
                graphics.fill();
            });

            const button = new Node('ActionButton');
            button.layer = Layers.Enum.UI_2D;
            button.setPosition(200, (skin.price >= 600 && !isUnlocked) ? 20 : 0, 0);
            cardNode.addChild(button);
            const buttonTrans = button.addComponent(UITransform);
            buttonTrans.setContentSize(130, 48);

            let buttonColor = COLOR_BTN_BG;
            let buttonText = '';
            if (isEquipped) {
                buttonColor = new Color(120, 180, 90);
                buttonText = '已使用';
            } else if (isUnlocked) {
                buttonColor = new Color(242, 177, 121);
                buttonText = '使用';
            } else {
                const canBuy = SkinManager.instance.getCoins() >= skin.price;
                buttonColor = canBuy ? new Color(246, 124, 95) : new Color(180, 170, 160);
                buttonText = `🪙 ${skin.price}`;
            }
            this.drawPanel(button, buttonColor, 8);
            this.makeLabel(buttonText, 20, COLOR_TEXT_LIGHT, button, Vec3.ZERO);

            if (!isEquipped) {
                button.on(Node.EventType.TOUCH_END, () => {
                    if (isUnlocked) {
                        SkinManager.instance.equipSkin(skin.id);
                        this.callbacks.onSkinChanged();
                    } else if (SkinManager.instance.buySkin(skin.id)) {
                        this.callbacks.onSkinChanged();
                    }
                }, this);
            }

            if (!isUnlocked && skin.price >= 600) {
                const adButton = new Node('AdUnlockButton');
                adButton.layer = Layers.Enum.UI_2D;
                adButton.setPosition(200, -35, 0);
                cardNode.addChild(adButton);
                const adButtonTrans = adButton.addComponent(UITransform);
                adButtonTrans.setContentSize(130, 40);
                this.drawPanel(adButton, new Color(100, 150, 240), 8);
                const adProgress = SkinManager.instance.getAdWatchedCount(skin.id);
                this.makeLabel(`🎬 解锁 (${adProgress}/5)`, 16, COLOR_TEXT_LIGHT, adButton, Vec3.ZERO);
                adButton.on(Node.EventType.TOUCH_END, async () => {
                    const success = await AdManager.instance.showRewardedVideo('shop_freebie');
                    if (success) {
                        const unlocked = SkinManager.instance.watchAdForSkin(skin.id);
                        if (unlocked) SkinManager.instance.equipSkin(skin.id);
                        this.callbacks.onSkinChanged();
                    } else {
                        this.callbacks.onRewardedAdFailure();
                    }
                }, this);
            }
        });
    }

    public updateCoinsLabel(): void {
        if (this.coinsLabel && this.coinsLabel.isValid) {
            this.coinsLabel.string = `当前金币: 🪙 ${SkinManager.instance.getCoins()}`;
        }
    }

    private drawPanel(node: Node, color: Color, radius: number): void {
        const sourceTransform = node.getComponent(UITransform);
        if (!sourceTransform) return;
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
        graphics.clear();
        this.roundRect(graphics, -transform.width / 2, -transform.height / 2, transform.width, transform.height, radius);
        graphics.fillColor = color;
        graphics.fill();
        node.getComponent(BlockInputEvents) || node.addComponent(BlockInputEvents);
    }

    private drawOverlayMask(node: Node): void {
        const transform = node.getComponent(UITransform);
        if (!transform) return;
        const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
        graphics.clear();
        graphics.fillColor = COLOR_MASK;
        graphics.rect(-transform.width / 2, -transform.height / 2, transform.width, transform.height);
        graphics.fill();
    }

    private makeLabel(text: string, fontSize: number, color: Color, parent: Node, pos: Vec3): Label {
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

    private clampLabelToCard(label: Label, textWidth: number, leftX = -240): void {
        const transform = label.node.getComponent(UITransform);
        if (transform) transform.setContentSize(textWidth, label.lineHeight);
        label.overflow = Label.Overflow.SHRINK;
        const pos = label.node.position;
        label.node.setPosition(leftX + textWidth / 2, pos.y, pos.z);
    }

    private roundRect(graphics: Graphics, x: number, y: number, width: number, height: number, radius: number): void {
        graphics.roundRect(x, y, width, height, Math.min(radius, Math.abs(width) / 2, Math.abs(height) / 2));
    }
}
