# 2048 BOOM 微信小游戏发布与广告接入配置文档

本文档适用于当前项目：`Cocos Creator 3.8.8 + TypeScript`。

目标是将项目发布为微信小游戏，并接入以下广告能力：

- 激励视频广告：复活、收益 X3、能量补充、皮肤解锁、称号抽卡。
- Banner 广告：难度选择、皮肤商店、称号面板等非核心操作界面。
- 插屏广告：按游戏流程间隔展示。

> 重要：当前仓库已经在 `assets/scripts/AdManager.ts` 中接入微信小游戏广告 API，并通过 `assets/resources/config/ad_config.json` 读取广告位配置。配置文件中的广告位 ID 当前为空，替换为微信后台真实 ID 后才能在微信真机中展示广告。

## 一、先确认发布目标

### 1. 本项目应发布为“微信小游戏”

Cocos Creator 的游戏项目应选择微信小游戏构建目标。项目中的平台判断已经使用：

```ts
sys.platform === sys.Platform.WECHAT_GAME
```

微信小游戏运行时可以使用：

```ts
wx.createRewardedVideoAd(...)
wx.createBannerAd(...)
wx.createInterstitialAd(...)
```

### 2. 不要混淆“微信小游戏”和“普通微信小程序”

普通微信小程序是页面/组件应用，微信小游戏是游戏运行环境。当前项目包含 Cocos 场景、渲染循环、触摸输入和游戏资源，应走“微信小游戏”发布流程，而不是把 Cocos 场景当作普通小程序页面嵌入。

如果后续需要做活动页、排行榜页或客服页，可以另建普通小程序或 Web 页面，通过跳转、客服消息或其他合规方式与小游戏配合；游戏本体仍应以微信小游戏构建。

## 二、当前代码广告能力盘点

### 1. 已有广告入口

| 场景标识 | 广告类型 | 当前调用位置 | 成功后的游戏行为 |
| --- | --- | --- | --- |
| `revive` | 激励视频 | `GameManager.ts` 结果弹窗 | 复活并移除最小的 5 个方块 |
| `double_coin` | 激励视频 | `GameManager.ts` 结果弹窗 | 额外增加本局金币的 2 倍，达到总收益 X3 |
| `energy_refill` | 激励视频 | `GameManager.ts` 能量按钮 | 能量恢复到最大值 |
| `shop_freebie` | 激励视频 | `GameManager.ts` 皮肤商店 | 累计广告次数，达到 5 次后解锁皮肤 |
| `title_free_gacha` | 激励视频 | `GameManager.ts` 称号抽卡 | 消耗一次免费广告抽卡次数并执行抽卡 |
| `title_ten_half` | 激励视频 | `GameManager.ts` 称号抽卡 | 看广告后以半价执行十连抽 |
| `banner` | Banner | 难度选择、商店、称号界面 | 展示底部横幅 |
| `interstitial` | 插屏 | `runWithInterstitialTransition()` | 按当前逻辑每 3 次请求尝试展示一次 |

### 2. 当前 `AdManager.ts` 的实际状态

当前实现按运行平台区分行为：微信小游戏调用真实广告 API，Web/编辑器预览继续使用模拟广告。微信环境下会区分：

```ts
showRewardedVideo(scenario: string): Promise<boolean>
```

- 广告是否成功加载；
- 广告是否真正展示；
- 用户是否看完广告；
- 用户是否中途关闭；
- 当前广告位是否无广告库存；
- 微信 API 是否返回错误；
- 广告位 ID 是否已经配置。

微信正式版只在激励视频的 `onClose` 回调确认完整观看后返回 `true`。广告位 ID 为空时不会调用创建广告对象，业务调用会得到 `false`，游戏继续运行。

## 三、微信公众平台准备工作

### 1. 注册与创建小游戏

在微信公众平台完成以下工作：

1. 注册或登录微信公众平台账号。
2. 创建账号类型为“小游戏”的项目。
3. 完成主体认证、基本信息、头像、名称、类目和隐私相关配置。
4. 获取小游戏 `AppID`。
5. 确认账号和小游戏具备流量主/广告组件的使用资格。

平台后台的菜单名称、准入条件和审核要求可能随微信版本调整，应以当前微信公众平台显示内容为准。

### 2. 创建广告位

建议至少创建以下广告位：

| 广告位 | 后台广告类型 | 建议用途 |
| --- | --- | --- |
| 激励视频广告位 | 激励视频 | 所有 `showRewardedVideo()` 场景共用一个广告位 |
| Banner 广告位 | Banner | 商店、称号、难度选择界面 |
| 插屏广告位 | 插屏 | 游戏局间或流程切换 |

当前 `AdManager` 的接口按场景区分，但微信广告位通常不必为每个激励场景单独创建。推荐先使用一个激励视频广告位，通过 `scenario` 记录业务用途。

只有在数据分析确实需要分开统计时，才为 `revive`、`double_coin` 等场景创建不同广告位。广告位过多会增加配置和审核管理成本。

创建完成后记录以下信息：

- 小游戏 AppID；
- 激励视频广告位 ID；
- Banner 广告位 ID；
- 插屏广告位 ID；
- 测试环境和正式环境的使用规则；
- 广告位当前状态、审核状态和可投放状态。

不要在文档、截图或仓库中提交真实账号密码。AppID 和广告位 ID 会出现在客户端构建物中，不能当作密钥使用；如果业务需要防止奖励伪造，必须增加服务端校验或服务端记账。

## 四、推荐的广告配置文件

当前项目已有 `assets/resources/config/title_config.json`，建议将广告配置也放在同一配置目录，便于后期切换测试位和正式位。

建议新增文件：

```text
assets/resources/config/ad_config.json
```

配置模板如下，所有值都需要替换为微信公众平台实际创建的广告位 ID：

```json
{
  "enabled": true,
  "wechatGame": {
    "bannerAdUnitId": "替换为微信Banner广告位ID",
    "rewardedAdUnitId": "替换为微信激励视频广告位ID",
    "interstitialAdUnitId": "替换为微信插屏广告位ID",
    "banner": {
      "enabled": true,
      "bottomOffset": 0,
      "refreshOnShow": true
    },
    "rewarded": {
      "enabled": true,
      "loadTimeoutMs": 10000,
      "scenarios": {
        "revive": true,
        "double_coin": true,
        "energy_refill": true,
        "shop_freebie": true,
        "title_free_gacha": true,
        "title_ten_half": true
      }
    },
    "interstitial": {
      "enabled": true,
      "requestInterval": 3
    }
  }
}
```

### 配置字段说明

| 字段 | 说明 |
| --- | --- |
| `enabled` | 全局广告开关。关闭后所有广告调用都应返回失败或直接跳过，不影响游戏继续运行。 |
| `bannerAdUnitId` | 微信 Banner 广告位 ID。 |
| `rewardedAdUnitId` | 微信激励视频广告位 ID。 |
| `interstitialAdUnitId` | 微信插屏广告位 ID。 |
| `bottomOffset` | Banner 距离底部的额外偏移量，通常为 0。 |
| `refreshOnShow` | 每次进入商店或称号面板时是否重新调用 `show()`。 |
| `loadTimeoutMs` | 激励视频加载等待上限，避免按钮永久等待。 |
| `scenarios` | 允许使用激励视频的业务场景白名单。 |
| `requestInterval` | 插屏请求间隔。当前游戏逻辑使用 3 次。 |

广告位 ID 不是加密配置。不要把安全密钥、用户 Token 或服务端密钥放进这个 JSON，也不要指望在客户端隐藏广告位 ID。

## 五、Cocos Creator 构建配置

### 1. 构建前检查

在 Cocos Creator 3.8.8 中打开项目后：

1. 确认当前项目能正常打开 `assets/scenes/Splash.scene` 和 `assets/scenes/Main.scene`。
2. 确认 `assets/scripts/AdManager.ts`、`GameManager.ts` 和其 `.meta` 文件存在。
3. 确认 `assets/resources/config/ad_config.json` 被放在 `resources` 目录下，并填入真实广告位 ID。
4. 确认构建平台选择“微信小游戏”。
5. 填写微信小游戏 AppID。
6. 选择构建目录，例如：

```text
build/wechatgame
```

实际目录名以 Cocos Creator 的构建面板为准；当前仓库已有 `build/web-mobile`，它不是微信小游戏构建产物，不能直接导入微信开发者工具作为正式小游戏运行。

### 2. 建议的构建选项

构建时重点检查：

- 方向设置为竖屏，和当前设计分辨率 `720 x 1280` 一致；
- 资源压缩、远程资源和分包策略符合小游戏包体限制；
- 开发阶段保留 Source Map 或调试信息，正式包再按发布要求关闭；
- 不要把 Web 版本目录误导入微信开发者工具；
- 构建完成后检查生成目录中是否包含 `game.js`、项目配置和资源文件。

### 3. 导入微信开发者工具

1. 安装与当前账号匹配版本的微信开发者工具。
2. 使用“导入项目”导入 Cocos 生成的微信小游戏构建目录。
3. 填写微信小游戏 AppID。
4. 检查项目目录、调试基础库和编译设置。
5. 在开发者工具中查看 Console，确认日志出现：

```text
[AdManager] 检测到微信小游戏环境
```

如果仍然显示“网页或调试环境，使用模拟广告”，说明当前运行环境没有被识别为微信小游戏，或者运行的不是微信小游戏构建产物。

## 六、`AdManager` 微信实现要求

### 1. 平台分支原则

广告管理器必须保持跨平台安全：

```text
微信小游戏 -> 调用 wx 广告 API
Native      -> 保留原生广告 SDK 接口
抖音小游戏  -> 保留抖音广告 SDK 接口
Web/编辑器  -> 使用模拟广告
```

不能在模块加载阶段无条件访问 `wx`，否则 Web 预览和 Cocos 编辑器环境会因为 `wx is not defined` 直接报错。

### 2. 推荐的微信广告对象

广告对象应只创建一次并缓存：

```ts
private wechatRewardedAd: any = null;
private wechatBannerAd: any = null;
private wechatInterstitialAd: any = null;
```

实际项目可以为微信 API 增加类型声明；如果没有安装对应类型包，至少要使用运行时平台判断，避免在非微信环境访问全局 `wx`。

### 3. 激励视频核心流程

激励视频的正确流程是：

```text
点击业务按钮
    ↓
检查平台、广告开关和场景白名单
    ↓
创建或取得缓存的 RewardedVideoAd
    ↓
绑定一次性 onClose 回调
    ↓
调用 show()
    ↓
show 失败时尝试 load() 后再次 show()
    ↓
onClose 判断 res.isEnded
    ↓
完整观看 -> Promise.resolve(true)
提前关闭/加载失败/播放失败 -> Promise.resolve(false)
```

示例结构如下：

```ts
private showWechatRewardedVideo(adUnitId: string): Promise<boolean> {
    return new Promise((resolve) => {
        let settled = false;
        const finish = (success: boolean) => {
            if (settled) return;
            settled = true;
            resolve(success);
        };

        let ad = this.wechatRewardedAd;
        if (!ad) {
            ad = wx.createRewardedVideoAd({ adUnitId });
            this.wechatRewardedAd = ad;
            ad.onError((error: unknown) => {
                console.error('[AdManager] 激励视频错误', error);
            });
        }

        const onClose = (result: { isEnded?: boolean } | undefined) => {
            ad.offClose(onClose);
            finish(Boolean(result && result.isEnded));
        };

        ad.onClose(onClose);
        ad.show().catch(() => {
            ad.load()
                .then(() => ad.show())
                .catch((error: unknown) => {
                    console.error('[AdManager] 激励视频加载失败', error);
                    ad.offClose(onClose);
                    finish(false);
                });
        });
    });
}
```

这个示例表达的是接入原则。实际代码还需要根据项目的 TypeScript 类型声明、微信基础库版本和 Cocos 构建产物调整。

### 4. 只在完整观看后发奖

业务调用方已经使用统一形式：

```ts
const success = await AdManager.instance.showRewardedVideo('revive');
if (success) {
    // 发放复活奖励
}
```

必须保持以下规则：

- `show()` 成功不等于用户看完；
- `onClose` 的 `isEnded === true` 才能发奖；
- 用户中途关闭、广告加载失败、广告播放失败都不能发奖；
- Promise 必须保证只 resolve 一次；
- 按钮在等待广告期间应暂时禁用，避免重复触发多个广告请求；
- 广告成功后的奖励逻辑应保持在 `GameManager` 或对应业务模块，不要把棋盘和金币业务硬编码进 `AdManager`。

当前项目的 `SkinManager.watchAdForSkin()` 是在激励视频成功后才调用，接入真实 API 后应继续保持这个顺序。

### 5. Banner 接入要求

Banner 广告应在微信小游戏环境创建：

```ts
wx.createBannerAd({
    adUnitId,
    style: {
        left: 0,
        top: 0,
        width: 300
    }
});
```

需要根据 `wx.getSystemInfoSync()` 的 `windowWidth` 和 `windowHeight` 计算位置。推荐放在屏幕底部，并避开游戏的核心按钮和弹窗操作区。

Banner 的生命周期建议如下：

| 游戏状态 | Banner 行为 |
| --- | --- |
| 难度选择界面 | `show()` |
| 进入游戏棋盘 | `hide()` |
| 打开皮肤商店 | `show()` |
| 打开称号面板 | `show()` |
| 关闭商店/称号面板 | 没有其它弹窗时 `hide()` |
| 结果弹窗 | 按 UI 设计决定，建议不遮挡奖励按钮 |

当前 `GameManager` 已经在难度选择、商店和称号界面调用 `showBanner()`，在开始游戏和关闭对应面板时调用 `hideBanner()`。因此正式接入主要是补齐 `AdManager` 的微信 API，不需要重新设计这些业务入口。

Banner 可能因为无填充、网络错误或尺寸限制而展示失败。Banner 失败不能阻塞游戏流程，也不能影响激励视频和插屏广告。

### 6. 插屏接入要求

插屏不提供奖励，建议封装成不阻塞主流程的方法：

```ts
public showInterstitial(force = false): void {
    this.interstitialCount++;
    if (!force && this.interstitialCount % 3 !== 0) return;

    const ad = this.getWechatInterstitialAd();
    if (!ad) return;

    ad.show().catch((error: unknown) => {
        console.warn('[AdManager] 插屏展示失败', error);
    });
}
```

当前代码在难度切换前使用 `runWithInterstitialTransition()`，并以每 3 次请求尝试展示一次为默认策略。正式发布前应在真机验证这个频率是否过于频繁，并以微信广告规范和实际留存数据调整。

不要在以下时机强制展示插屏：

- 激励视频刚刚关闭后立即展示；
- 用户正在进行滑动操作时；
- 游戏刚启动、用户还没有完成首次操作时；
- 用户正在看结果或领取奖励时；
- 频繁连续点击按钮时。

## 七、建议的 `AdManager` 配置映射

建议将现有字符串场景固定为联合类型，避免拼写错误：

```ts
export type RewardedScenario =
    | 'revive'
    | 'double_coin'
    | 'energy_refill'
    | 'shop_freebie'
    | 'title_free_gacha'
    | 'title_ten_half';
```

然后使用配置中的白名单检查：

```ts
private isRewardedScenarioEnabled(scenario: string): boolean {
    return Boolean(this.config.wechatGame.rewarded.scenarios[scenario]);
}
```

这样可以在广告位异常、活动下线或某个场景暂时关闭时，只关闭对应场景，不影响其它游戏功能。

## 八、开发、真机和正式环境测试

### 1. 不要只依赖开发者工具模拟器

微信广告在开发者工具中可能没有真实填充，激励视频、Banner 或插屏可能不展示或行为不完整。广告接入必须至少使用一台真实微信设备测试。

### 2. 激励视频测试用例

| 测试项 | 预期结果 |
| --- | --- |
| 正常看完 `revive` | 只发放一次复活奖励 |
| 中途关闭 `revive` | 不复活，Promise 返回 `false` |
| 正常看完 `double_coin` | 只增加一次额外金币，按钮隐藏 |
| 快速连续点击按钮 | 只产生一个广告请求，不重复发奖 |
| 无网络 | 显示失败提示或静默失败，游戏仍可继续 |
| 广告无库存 | 不发奖，不让按钮永久 loading |
| `energy_refill` 成功 | 能量变为最大值 |
| 皮肤广告第 1 至第 4 次 | 只增加对应进度 |
| 皮肤广告第 5 次 | 解锁并装备皮肤一次 |
| `title_free_gacha` 成功 | 只消耗一次免费次数并抽卡一次 |
| `title_ten_half` 成功 | 扣费和抽卡各执行一次 |
| 切换到 Web 预览 | 使用模拟逻辑，不访问 `wx` |

### 3. Banner 测试用例

- 进入难度选择时显示；
- 开始游戏时隐藏；
- 打开商店时显示；
- 关闭商店后隐藏；
- 打开称号面板时显示；
- 横竖屏或不同尺寸设备下不遮挡按钮；
- Banner 加载失败时游戏仍可操作；
- 重复调用 `showBanner()` 不创建多个 Banner 实例；
- 场景销毁时解绑回调并隐藏/销毁广告对象。

### 4. 插屏测试用例

- 第 1、2 次请求不展示；
- 第 3 次请求尝试展示；
- 插屏加载失败不阻塞难度切换；
- 激励视频关闭后不会立刻叠加插屏；
- 多次进入场景不会意外重置或重复累加计数器。

## 九、日志和故障排查

建议统一日志前缀，至少记录：

```text
[AdManager] platform=WECHAT_GAME
[AdManager] rewarded request scenario=revive
[AdManager] rewarded shown scenario=revive
[AdManager] rewarded closed scenario=revive isEnded=true
[AdManager] rewarded reward scenario=revive
[AdManager] rewarded error code=...
[AdManager] banner show
[AdManager] banner hide
[AdManager] interstitial request count=3
```

排查顺序：

1. 确认导入的是微信小游戏构建目录，而不是 `build/web-mobile`。
2. 确认微信小游戏 AppID 正确。
3. 确认广告位 ID 属于当前小游戏账号。
4. 确认运行日志识别为 `WECHAT_GAME`。
5. 确认广告位已创建、启用并满足平台准入条件。
6. 确认真机网络正常，且没有把开发工具的无填充当成代码错误。
7. 检查 `onError` 中的错误码和错误信息。
8. 确认没有在非微信环境访问全局 `wx`。

常见问题：

| 现象 | 可能原因 | 处理方式 |
| --- | --- | --- |
| `wx is not defined` | Web 预览或编辑器中无条件访问 `wx` | 所有微信 API 放入平台判断分支 |
| 点击激励按钮没有反应 | 广告对象未创建、ID 为空或 Promise 未处理异常 | 检查初始化、ID 和 `show().catch()` |
| 看完广告没有奖励 | 只处理了 `show()`，没有处理 `onClose` | 在 `onClose` 判断 `isEnded` 后返回成功 |
| 提前关闭也获得奖励 | 把 `onClose` 当作成功 | 只有 `isEnded === true` 才发奖 |
| Banner 遮住按钮 | `style.top`、`style.width` 或底部位置未适配 | 根据窗口尺寸重新计算 Banner 样式 |
| 广告只第一次能播 | 没有缓存/重新加载处理或事件重复绑定 | 缓存广告对象，失败后 `load()`，一次请求只绑定一次关闭回调 |
| 真机没有广告但代码无错 | 无填充、广告位状态或账号准入问题 | 查后台状态，换真机和合规测试位验证 |
| Web 预览仍模拟成功 | 这是预期行为 | Web 预览仅用于 UI 和逻辑调试，广告必须真机验证 |

## 十、数据与安全注意事项

当前金币、皮肤和称号数据主要使用 `sys.localStorage` 保存，例如：

- `2048_total_coins`；
- `2048_unlocked_skins`；
- `2048_equipped_skin`；
- `2048_ad_progress`。

这适合单机休闲游戏原型，但不能作为防作弊的可信数据源。客户端代码、LocalStorage 和广告回调都可能被修改。如果未来涉及排行榜、兑换、提现、付费道具或可交易资产，建议增加：

- 用户身份和登录体系；
- 服务端金币账本；
- 服务端校验广告奖励凭证或业务事件；
- 奖励幂等键，避免重复发放；
- 异常请求频率限制；
- 排行榜服务端校验。

不要通过修改广告回调结果来“提高广告收益”。平台审核关注广告是否诱导点击、是否误触、是否以虚假承诺诱导观看，按钮文案和展示时机应真实、明确、可关闭。

另外，当前 `SkinManager.ts` 中存在开发测试代码：

```ts
this.coins = 9999999; // 【开发测试】强制给满金币
```

正式发布前必须移除或改为明确的开发环境条件，否则会覆盖本地读取的金币数据，导致经济系统失效。该问题与广告 API 接入直接相关，发布前必须处理。

## 十一、正式发布前清单

### 微信后台

- [ ] 已创建微信小游戏账号并取得 AppID。
- [ ] 已完成主体、类目、隐私和版本发布所需配置。
- [ ] 已创建激励视频广告位。
- [ ] 已创建 Banner 广告位。
- [ ] 已创建插屏广告位。
- [ ] 广告位 ID 已替换为当前小游戏账号对应的真实 ID。
- [ ] 已确认广告组件准入、审核和投放状态。

### Cocos 构建

- [ ] 构建平台为微信小游戏。
- [ ] 构建目录不是 `build/web-mobile`。
- [ ] AppID 与微信后台一致。
- [ ] 竖屏和设计分辨率符合预期。
- [ ] 包体和资源大小符合当前平台限制。
- [ ] 生产构建没有遗留开发测试金币。

### 代码

- [ ] `AdManager` 只在微信小游戏分支访问 `wx`。
- [ ] 激励视频使用 `onClose` 判断 `isEnded`。
- [ ] 激励视频失败和提前关闭都不会发奖。
- [ ] Promise 不会重复 resolve，也不会永久 pending。
- [ ] 激励按钮在请求期间不会重复提交。
- [ ] Banner 可以重复显示/隐藏且不会创建多个实例。
- [ ] 插屏失败不会阻塞游戏流程。
- [ ] 所有现有场景标识均已映射：`revive`、`double_coin`、`energy_refill`、`shop_freebie`、`title_free_gacha`、`title_ten_half`。

### 真机验证

- [ ] 至少使用一台真实 iOS 设备和一台真实 Android 设备测试，或根据项目目标覆盖实际设备。
- [ ] 测试正常观看、提前关闭、无网络、无填充、重复点击。
- [ ] 测试商店、称号、难度选择和结果弹窗之间的 Banner 生命周期。
- [ ] 测试切后台、回前台、重进游戏后的广告状态。
- [ ] 测试广告奖励只发放一次。

## 十二、推荐实施顺序

按当前项目的最小改动原则，建议按以下顺序实施：

1. 在微信公众平台创建小游戏和三个广告位。
2. 将微信后台的广告位 ID 填入 `assets/resources/config/ad_config.json`。
3. 构建微信小游戏，并优先验证 `revive`、`energy_refill` 两个低风险场景。
4. 在真机验证 Banner 的难度选择、商店和称号界面生命周期。
5. 在真机验证插屏失败不会阻塞游戏流程。
6. 为所有广告按钮增加请求中状态和重复点击保护。
7. 在真机完成完整广告矩阵测试。
8. 移除 `SkinManager.ts` 的测试金币逻辑。
9. 提交体验版，再根据审核和数据调整展示频率。

当前最重要的结论是：`AdManager.ts` 已经提供了业务层接口并完成微信小游戏广告 API 封装，现有 `GameManager.ts` 的广告场景也基本接好；下一步是将真实广告位 ID 填入配置文件，构建微信小游戏并完成真机验证。
