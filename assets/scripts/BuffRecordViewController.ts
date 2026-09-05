import { Color, Graphics, Label, Layers, Node, tween, Tween, UITransform, UIOpacity, Vec3 } from 'cc';

interface BuffRecord {
    node: Node;
    opacity: UIOpacity;
}

const MAX_RECORDS = 3;
const DISPLAY_SECONDS = 5;
const RECORD_WIDTH = 300;
const RECORD_HEIGHT = 40;
const RECORD_GAP = 6;
const RIGHT_X = 190;
const BOTTOM_Y = -614;

/** 非阻塞的局内 Buff 记录列表，固定显示在游戏页面右下角。 */
export class BuffRecordViewController {
    private readonly parent: Node;
    private root: Node | null = null;
    private records: BuffRecord[] = [];

    public constructor(parent: Node) {
        this.parent = parent;
    }

    public setup(): void {
        if (this.root?.isValid) return;
        const root = new Node('BuffRecordList');
        root.layer = Layers.Enum.UI_2D;
        root.setPosition(0, 0, 20);
        this.parent.addChild(root);
        const transform = root.addComponent(UITransform);
        transform.setContentSize(720, 1280);
        this.root = root;
    }

    public show(message: string): void {
        if (!message) return;
        if (!this.root?.isValid) this.setup();
        if (!this.root) return;

        while (this.records.length >= MAX_RECORDS) {
            this.remove(this.records[0]);
        }

        const node = new Node('BuffRecord');
        node.layer = Layers.Enum.UI_2D;
        this.root.addChild(node);
        const transform = node.addComponent(UITransform);
        transform.setContentSize(RECORD_WIDTH, RECORD_HEIGHT);

        const background = node.addComponent(Graphics);
        background.roundRect(-RECORD_WIDTH / 2, -RECORD_HEIGHT / 2, RECORD_WIDTH, RECORD_HEIGHT, 8);
        background.fillColor = new Color(67, 45, 94, 210);
        background.fill();

        const labelNode = new Node('Label');
        labelNode.layer = Layers.Enum.UI_2D;
        labelNode.setPosition(2, 0, 1);
        node.addChild(labelNode);
        const label = labelNode.addComponent(Label);
        const labelTransform = labelNode.getComponent(UITransform);
        if (labelTransform) labelTransform.setContentSize(RECORD_WIDTH - 24, RECORD_HEIGHT - 8);
        label.string = message;
        label.fontSize = 16;
        label.lineHeight = 20;
        label.color = new Color(255, 255, 255, 255);
        label.isBold = true;
        label.horizontalAlign = Label.HorizontalAlign.RIGHT;
        label.verticalAlign = Label.VerticalAlign.CENTER;
        label.overflow = Label.Overflow.SHRINK;

        const opacity = node.addComponent(UIOpacity);
        opacity.opacity = 0;
        const record = { node, opacity };
        this.records.push(record);
        this.layout();

        tween(opacity)
            .to(0.12, { opacity: 255 })
            .delay(DISPLAY_SECONDS - 0.42)
            .to(0.3, { opacity: 0 })
            .call(() => this.remove(record, false))
            .start();
    }

    /** 新开局时立即清除上一局全部 Buff 记录和计时。 */
    public clear(): void {
        for (const record of this.records) {
            Tween.stopAllByTarget(record.opacity);
            if (record.node.isValid) record.node.destroy();
        }
        this.records.length = 0;
    }

    private remove(record: BuffRecord, stopTween = true): void {
        const index = this.records.indexOf(record);
        if (index < 0) return;
        if (stopTween) Tween.stopAllByTarget(record.opacity);
        this.records.splice(index, 1);
        if (record.node.isValid) record.node.destroy();
        this.layout();
    }

    private layout(): void {
        const lastIndex = this.records.length - 1;
        this.records.forEach((record, index) => {
            const rowFromBottom = lastIndex - index;
            record.node.setPosition(new Vec3(
                RIGHT_X,
                BOTTOM_Y + rowFromBottom * (RECORD_HEIGHT + RECORD_GAP),
                0,
            ));
        });
    }
}
