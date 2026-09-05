import {
    BlockInputEvents, Color, Graphics, Label, Layers, Node, tween, UITransform, UIOpacity, Vec3,
} from 'cc';
import { AdManager } from './AdManager';
import { SkinManager } from './SkinManager';
import { BuffType, formatBuffText, TitleConfig, TitleManager } from './TitleManager';

const COLOR_TEXT_DARK = new Color(119, 110, 101);
const COLOR_TEXT_LIGHT = new Color(249, 246, 242);
const COLOR_MASK = new Color(0, 0, 0, 160);

export interface TitleViewCallbacks {
    onOpen: (overlay: Node) => void;
    onClose: () => void;
    onTitleEquipped: () => void;
    onToast: (message: string, duration?: number) => void;
    onRewardedAdFailure: () => void;
}

/** 运行时生成的称号页面，负责抽卡、背包、图鉴的展示和交互。 */
export class TitleViewController {
    private readonly parent: Node;
    private readonly callbacks: TitleViewCallbacks;
    private overlay: Node | null = null;
    private panel: Node | null = null;
    private contentContainer: Node | null = null;
    private tab: 'gacha' | 'inventory' | 'catalog' = 'gacha';
    private catalogPage = 0;
    private inventoryPage = 0;

    public constructor(parent: Node, callbacks: TitleViewCallbacks) {
        this.parent = parent;
        this.callbacks = callbacks;
    }

    public getOverlay(): Node | null {
        return this.overlay;
    }

    public setup(): void {
        if (this.overlay && this.overlay.isValid) return;

        const overlay = new Node('TitleOverlay');
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
        this.makeLabel('称号系统', 36, COLOR_TEXT_DARK, panel, new Vec3(0, 390, 0));

        const closeBtn = new Node('CloseButton');
        closeBtn.layer = Layers.Enum.UI_2D;
        closeBtn.setPosition(270, 390, 0);
        panel.addChild(closeBtn);
        const closeTrans = closeBtn.addComponent(UITransform);
        closeTrans.setContentSize(46, 46);
        this.drawPanel(closeBtn, new Color(214, 70, 48), 23);
        this.makeLabel('✕', 26, COLOR_TEXT_LIGHT, closeBtn, Vec3.ZERO);
        closeBtn.on(Node.EventType.TOUCH_END, () => this.close(), this);

        const tabBar = new Node('TabBar');
        tabBar.layer = Layers.Enum.UI_2D;
        tabBar.setPosition(0, 340, 0);
        panel.addChild(tabBar);
        const tabs = ['gacha', 'inventory', 'catalog'] as const;
        const tabLabels = ['🎴 抽卡', '🎒 背包', '📖 图鉴'];
        tabs.forEach((tab, index) => {
            const button = new Node(`Tab_${tab}`);
            button.layer = Layers.Enum.UI_2D;
            button.setPosition(-190 + index * 190, 0, 0);
            tabBar.addChild(button);
            const buttonTrans = button.addComponent(UITransform);
            buttonTrans.setContentSize(180, 48);
            this.drawPanel(button, new Color(220, 210, 200), 8);
            this.makeLabel(tabLabels[index], 22, COLOR_TEXT_DARK, button, Vec3.ZERO);
            button.on(Node.EventType.TOUCH_END, () => {
                this.tab = tab;
                this.refresh();
            }, this);
        });

        const contentContainer = new Node('ContentContainer');
        contentContainer.layer = Layers.Enum.UI_2D;
        contentContainer.setPosition(0, -30, 0);
        panel.addChild(contentContainer);

        this.overlay = overlay;
        this.panel = panel;
        this.contentContainer = contentContainer;
        this.refresh();
        this.overlay.active = false;
    }

    public open(): void {
        if (!this.overlay) return;
        this.callbacks.onOpen(this.overlay);
        this.overlay.active = true;
        AdManager.instance.showBanner();
        this.refresh();
        TitleManager.instance.whenReady(() => {
            if (this.overlay?.active && this.overlay.isValid) this.refresh();
        });
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
        if (!this.contentContainer) return;
        this.contentContainer.children.forEach((child) => child.destroy());
        this.contentContainer.removeAllChildren();
        if (this.tab === 'gacha') this.buildGachaTab();
        else if (this.tab === 'inventory') this.buildInventoryTab();
        else this.buildCatalogTab();
    }

    private buildGachaTab(): void {
        const container = this.contentContainer!;
        this.makeLabel(`🪙 ${SkinManager.instance.getCoins()}`, 22, new Color(215, 140, 0), container, new Vec3(0, 280, 0));

        const freeLeft = TitleManager.instance.getFreeAdLeftToday();
        this.makeLabel(
            `📺 免费抽：今日剩余 ${freeLeft} / ${TitleManager.instance.dailyFreeAdLimit} 次`,
            18,
            new Color(160, 150, 140),
            container,
            new Vec3(0, 240, 0),
        );

        const singleBtn = this.createButton('SingleGacha', `抽 1 次 (${TitleManager.instance.gachaPrice}🪙)`, new Vec3(0, 180, 0), new Color(150, 110, 220), 200, 56);
        singleBtn.on(Node.EventType.TOUCH_END, () => {
            if (SkinManager.instance.getCoins() < TitleManager.instance.gachaPrice) {
                this.callbacks.onToast('金币不足！');
                return;
            }
            const result = TitleManager.instance.gachaOnce();
            if (result) this.showGachaResult([result]);
            else this.callbacks.onToast('未中奖，下次好运！');
            this.refresh();
        }, this);

        const freeBtn = this.createButton('FreeAdGacha', freeLeft > 0 ? '🎬 免费广告抽' : '今日已用完', new Vec3(0, 110, 0), new Color(40, 160, 80), 200, 56);
        freeBtn.on(Node.EventType.TOUCH_END, async () => {
            if (TitleManager.instance.getFreeAdLeftToday() <= 0) {
                this.callbacks.onToast('今日免费次数已用完！');
                return;
            }
            const success = await AdManager.instance.showRewardedVideo('title_free_gacha');
            if (success) {
                const result = TitleManager.instance.gachaFreeAd();
                if (result) {
                    this.showGachaResult([result]);
                    this.refresh();
                }
            } else {
                this.callbacks.onRewardedAdFailure();
            }
        }, this);

        const tenCost = TitleManager.instance.gachaPrice * TitleManager.instance.gachaTenCount;
        const tenBtn = this.createButton('TenGacha', `十连 (${tenCost}🪙)`, new Vec3(0, 40, 0), new Color(200, 120, 40), 200, 56);
        tenBtn.on(Node.EventType.TOUCH_END, () => {
            if (SkinManager.instance.getCoins() < tenCost) {
                this.callbacks.onToast('金币不足！');
                return;
            }
            const results = TitleManager.instance.gachaTen(false);
            if (results.length > 0) this.showGachaResult(results);
            else this.callbacks.onToast('十连全部落空，再接再厉！');
            this.refresh();
        }, this);

        const halfCost = Math.floor(tenCost / 2);
        const adTenBtn = this.createButton('AdTenGacha', '🎬 广告十连半价', new Vec3(0, -30, 0), new Color(60, 140, 60), 200, 48);
        adTenBtn.on(Node.EventType.TOUCH_END, async () => {
            if (SkinManager.instance.getCoins() < halfCost) {
                this.callbacks.onToast('金币不足！');
                return;
            }
            const success = await AdManager.instance.showRewardedVideo('title_ten_half');
            if (success) {
                const results = TitleManager.instance.gachaTen(true);
                if (results.length > 0) this.showGachaResult(results);
                else this.callbacks.onToast('十连全部落空，再接再厉！');
                this.refresh();
            } else {
                this.callbacks.onRewardedAdFailure();
            }
        }, this);

        const equipped = TitleManager.instance.getEquippedTitle();
        if (equipped) this.makeLabel(`当前装备：${equipped.name}`, 18, new Color(100, 90, 80), container, new Vec3(0, -100, 0));
    }

    private buildInventoryTab(): void {
        const container = this.contentContainer!;
        const items = TitleManager.instance.getInventory();
        const equippedId = TitleManager.instance.getEquippedTitleId();
        if (items.length === 0) {
            this.makeLabel('暂无称号，快去抽卡吧！', 22, new Color(150, 140, 130), container, new Vec3(0, 200, 0));
            return;
        }

        const pageSize = 6;
        const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
        this.inventoryPage = Math.max(0, Math.min(this.inventoryPage, pageCount - 1));
        const pageItems = items.slice(this.inventoryPage * pageSize, this.inventoryPage * pageSize + pageSize);
        this.makeLabel(`拥有称号（共 ${items.length} 种）`, 22, COLOR_TEXT_DARK, container, new Vec3(0, 300, 0));

        const startY = 230;
        const cardHeight = 85;
        const gap = 12;
        pageItems.forEach(({ config, count }, index) => {
            const card = new Node(`TitleCard_${config.id}`);
            card.layer = Layers.Enum.UI_2D;
            card.setPosition(0, startY - index * (cardHeight + gap), 0);
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
                N: new Color(158, 158, 158), R: new Color(74, 144, 217), SR: new Color(155, 89, 208),
                SSR: new Color(242, 179, 15), UR: new Color(227, 74, 74),
            };
            let nameWidth = 0;
            for (const char of nameText) nameWidth += char.charCodeAt(0) > 255 ? 20 : 11;
            const rarityNode = new Node('RarityTag');
            rarityNode.layer = Layers.Enum.UI_2D;
            rarityNode.setPosition(Math.min(-240 + nameWidth + 8 + 30, 120), 15, 0);
            card.addChild(rarityNode);
            const rarityTrans = rarityNode.addComponent(UITransform);
            rarityTrans.setContentSize(60, 24);
            this.drawPanel(rarityNode, rarityColors[config.rarity] || new Color(200, 190, 180), 6);
            this.makeLabel(config.rarity, 16, COLOR_TEXT_LIGHT, rarityNode, Vec3.ZERO);

            const buffLabel = this.makeLabel(`✨ ${formatBuffText(config.buffType, config.buffValue)}`, 15, new Color(180, 110, 30), card, new Vec3(-240, -22, 0));
            buffLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(buffLabel, 360, -240);

            if (!isEquipped) {
                const equipBtn = this.createButton('EquipBtn', '装备', new Vec3(230, 0, 0), new Color(100, 180, 100), 80, 40, card);
                equipBtn.on(Node.EventType.TOUCH_END, () => {
                    if (TitleManager.instance.equipTitle(config.id)) this.callbacks.onTitleEquipped();
                    this.refresh();
                }, this);
            } else {
                this.createButton('UnequipBtn', '已装备', new Vec3(230, 0, 0), new Color(180, 160, 140), 80, 40, card);
            }

            if (config.rarity === 'SSR' && TitleManager.instance.canAscend(config.id)) {
                const ascendBtn = this.createButton('AscendBtn', '突破', new Vec3(130, 0, 0), new Color(240, 90, 90), 80, 40, card);
                ascendBtn.on(Node.EventType.TOUCH_END, () => {
                    const ur = TitleManager.instance.ascend(config.id);
                    if (ur) {
                        this.callbacks.onToast(`🎉 合成成功！获得 ${ur.name}`);
                        this.refresh();
                    }
                }, this);
            }
        });

        if (pageCount > 1) this.createPager(container, this.inventoryPage, pageCount, 'Inventory');
    }

    private buildCatalogTab(): void {
        const container = this.contentContainer!;
        const all = TitleManager.instance.getAllConfigs();
        const rarityRank: Record<string, number> = { N: 0, R: 1, SR: 2, SSR: 3, UR: 4 };
        all.sort((a, b) => (rarityRank[a.rarity] - rarityRank[b.rarity]) || a.id.localeCompare(b.id));
        const equippedId = TitleManager.instance.getEquippedTitleId();
        const pageSize = 6;
        const pageCount = Math.max(1, Math.ceil(all.length / pageSize));
        this.catalogPage = Math.max(0, Math.min(this.catalogPage, pageCount - 1));
        const pageTitles = all.slice(this.catalogPage * pageSize, this.catalogPage * pageSize + pageSize);
        const rarityColors: Record<string, Color> = {
            N: new Color(158, 158, 158), R: new Color(74, 144, 217), SR: new Color(155, 89, 208),
            SSR: new Color(242, 179, 15), UR: new Color(227, 74, 74),
        };
        this.makeLabel(`称号图鉴（共 ${all.length} 个）`, 22, COLOR_TEXT_DARK, container, new Vec3(0, 300, 0));

        const startY = 250;
        const cardHeight = 88;
        const gap = 10;
        pageTitles.forEach((config, index) => {
            const card = new Node(`CatalogCard_${config.id}`);
            card.layer = Layers.Enum.UI_2D;
            card.setPosition(0, startY - index * (cardHeight + gap), 0);
            container.addChild(card);
            const cardTrans = card.addComponent(UITransform);
            cardTrans.setContentSize(570, cardHeight);
            const isEquipped = config.id === equippedId;
            const ownedCount = TitleManager.instance.getOwnedCount(config.id);
            this.drawPanel(card, isEquipped ? new Color(235, 225, 210) : new Color(238, 228, 218), 10);
            const nameSuffix = isEquipped ? '（已装备）' : (ownedCount > 0 ? ` x${ownedCount}` : '');
            const nameLabel = this.makeLabel(`${config.name}${nameSuffix}`, 19, COLOR_TEXT_DARK, card, new Vec3(-240, 26, 0));
            nameLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(nameLabel, 450);
            const rarityNode = new Node('RarityTag');
            rarityNode.layer = Layers.Enum.UI_2D;
            rarityNode.setPosition(255, 26, 0);
            card.addChild(rarityNode);
            const rarityTrans = rarityNode.addComponent(UITransform);
            rarityTrans.setContentSize(56, 24);
            this.drawPanel(rarityNode, rarityColors[config.rarity] || new Color(200, 190, 180), 6);
            this.makeLabel(config.rarity, 16, COLOR_TEXT_LIGHT, rarityNode, Vec3.ZERO);
            const buffLabel = this.makeLabel(`✨ ${formatBuffText(config.buffType, config.buffValue)}`, 16, new Color(180, 110, 30), card, new Vec3(-240, -4, 0));
            buffLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(buffLabel, 500);
            const descLabel = this.makeLabel(config.desc, 14, new Color(130, 120, 110), card, new Vec3(-240, -32, 0));
            descLabel.horizontalAlign = Label.HorizontalAlign.LEFT;
            this.clampLabelToCard(descLabel, 500);
        });
        if (pageCount > 1) this.createPager(container, this.catalogPage, pageCount, 'Catalog');
    }

    private createPager(container: Node, page: number, pageCount: number, prefix: string): void {
        const pageBtnY = (prefix === 'Inventory' ? 230 : 250) - 6 * (prefix === 'Inventory' ? 97 : 98) - 20;
        const prev = this.createButton(`${prefix}Prev`, '◀ 上一页', new Vec3(-130, pageBtnY, 0), new Color(200, 190, 180), 110, 40, container);
        prev.on(Node.EventType.TOUCH_END, () => {
            if (prefix === 'Inventory' && this.inventoryPage > 0) this.inventoryPage--;
            if (prefix === 'Catalog' && this.catalogPage > 0) this.catalogPage--;
            this.refresh();
        }, this);
        this.makeLabel(`${page + 1} / ${pageCount}`, 18, COLOR_TEXT_DARK, container, new Vec3(0, pageBtnY, 0));
        const next = this.createButton(`${prefix}Next`, '下一页 ▶', new Vec3(130, pageBtnY, 0), new Color(200, 190, 180), 110, 40, container);
        next.on(Node.EventType.TOUCH_END, () => {
            if (prefix === 'Inventory' && this.inventoryPage < pageCount - 1) this.inventoryPage++;
            if (prefix === 'Catalog' && this.catalogPage < pageCount - 1) this.catalogPage++;
            this.refresh();
        }, this);
    }

    private showGachaResult(titles: TitleConfig[]): void {
        if (titles.length === 0) return;
        const top = titles[0];
        const summary = titles.length === 1 ? top.name : `${top.name} 等 ${titles.length} 个称号`;
        this.callbacks.onToast(`抽到：${summary}`, 2000);
    }

    private createButton(
        name: string,
        text: string,
        position: Vec3,
        color: Color,
        width: number,
        height: number,
        parent: Node = this.contentContainer!,
    ): Node {
        const button = new Node(name);
        button.layer = Layers.Enum.UI_2D;
        button.setPosition(position);
        parent.addChild(button);
        const transform = button.addComponent(UITransform);
        transform.setContentSize(width, height);
        this.drawPanel(button, color, Math.min(10, height / 2));
        this.makeLabel(text, Math.min(22, Math.max(16, height * 0.36)), COLOR_TEXT_LIGHT, button, Vec3.ZERO);
        return button;
    }

    private drawPanel(node: Node, color: Color, radius: number): void {
        const transform = node.getComponent(UITransform);
        if (!transform) return;
        const graphics = node.getComponent(Graphics) || node.addComponent(Graphics);
        graphics.clear();
        graphics.roundRect(-transform.width / 2, -transform.height / 2, transform.width, transform.height, Math.min(radius, transform.width / 2, transform.height / 2));
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

    private makeLabel(text: string, fontSize: number, color: Color, parent: Node, position: Vec3): Label {
        const node = new Node('Label');
        node.layer = Layers.Enum.UI_2D;
        node.setPosition(position);
        parent.addChild(node);
        const label = node.addComponent(Label);
        label.string = text;
        label.fontSize = fontSize;
        label.lineHeight = Math.round(fontSize * 1.3);
        label.color = color;
        label.horizontalAlign = Label.HorizontalAlign.CENTER;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;
        return label;
    }

    private clampLabelToCard(label: Label, textWidth: number, leftX = -240): void {
        const transform = label.node.getComponent(UITransform);
        if (transform) transform.setContentSize(textWidth, label.lineHeight);
        label.overflow = Label.Overflow.SHRINK;
        const position = label.node.position;
        label.node.setPosition(leftX + textWidth / 2, position.y, position.z);
    }
}
