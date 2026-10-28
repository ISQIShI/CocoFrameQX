import { ConfigExportScope, ConfigField, ConfigUpdateResult, ConfigValue } from './ConfigTypes';
import { ConfigTestSession, message } from './ConfigTestSession';
import { CONFIG_TEXT_LIMIT, ConfigSnapshot, configEqual } from './ConfigStore';

/** 面板打开时项目可暂停自己的输入；关闭时只撤销这一个暂停原因。 */
export interface ConfigPanelOptions { onVisibilityChange?: (visible: boolean) => void }

/** 一个字段的控件：读取可能因输入不完整而抛出，写入只改控件显示。 */
interface FieldControl { element: HTMLElement; focus: HTMLElement; read: () => ConfigValue; write: (value: ConfigValue) => void }

/** 分组树节点：分组路径按“·”逐级拆分；rows 为本级字段，all 含全部下级字段。 */
interface GroupNode {
    name: string; title: string; parent: GroupNode | null; children: GroupNode[];
    rows: FieldRow[]; all: FieldRow[]; section: HTMLDivElement | null;
}

/** 一行参数：控件只在挂载时创建一次，配置变化只刷新显示。 */
interface FieldRow {
    key: string; field: ConfigField; node: GroupNode; search: string;
    element: HTMLDivElement; control: FieldControl; marks: HTMLSpanElement; note: HTMLDivElement; restore: HTMLButtonElement;
    dirty: boolean; invalid: boolean;
}

/** 当前页面：分组目录或末级参数页（node）、混合分组的本级参数（own）、全部改动（changed）。 */
type PanelView = { kind: 'node' | 'own'; node: GroupNode } | { kind: 'changed' };

/** 未声明分组的字段在面板中的归类名称。 */
const UNGROUPED = '未分组';
/** 滑块只用于跨度适中的有界数值，避免大范围整数无法精确拖动。 */
const SLIDER_SPAN = 1000;

/**
 * 明亮的设置页风格：浅灰底上放白色分组卡，目录与参数都以卡内细线分行；
 * 主色只用于选中、未应用与主要操作，语义色只表达实时、重启、错误。
 */
const STYLE = ':host{all:initial}*{box-sizing:border-box}[hidden]{display:none!important}' +
    '.根{--底:#f3f5f8;--面:#fff;--浮:#eef1f5;--井:#fff;--线:#e3e7ed;--线强:#cdd4de;--字:#17202b;--次:#465365;--弱:#7a8697;' +
    '--主:#2c66d8;--主底:rgba(44,102,216,.08);--主边:rgba(44,102,216,.35);--实时:#147a57;--实时底:rgba(20,122,87,.1);' +
    '--重启:#9a5b06;--重启底:rgba(214,140,30,.14);--重启实:#f4b544;--错:#c73636;--错底:rgba(199,54,54,.07);' +
    '--等宽:ui-monospace,"Cascadia Mono",Consolas,"SF Mono",monospace;' +
    'font:13px/1.5 system-ui,-apple-system,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;color:var(--字);color-scheme:light}' +
    'button,input,select,textarea{font:inherit;color:inherit}' +
    'button{cursor:pointer;background:var(--面);border:1px solid var(--线强);border-radius:7px;padding:6px 12px;white-space:nowrap;transition:background .12s,border-color .12s}' +
    'button:hover:not(:disabled){background:var(--浮)}button:disabled{opacity:.45;cursor:default}' +
    'button.主{background:var(--主);border-color:var(--主);color:#fff;font-weight:600}button.主:hover:not(:disabled){background:#2559c2}' +
    'button.确认{background:var(--错);border-color:var(--错);color:#fff;font-weight:600}' +
    ':focus-visible{outline:2px solid var(--主);outline-offset:1px}' +
    'input,select,textarea{background:var(--井);border:1px solid var(--线强);border-radius:6px;padding:5px 8px;min-width:0}' +
    'input:focus,select:focus,textarea:focus{border-color:var(--主);outline:none;box-shadow:0 0 0 3px var(--主底)}' +
    'input[type=number]{font-family:var(--等宽);font-variant-numeric:tabular-nums;text-align:right}' +
    '.入口{position:fixed;top:calc(10px + env(safe-area-inset-top,0px));right:calc(10px + env(safe-area-inset-right,0px));display:flex;align-items:center;gap:7px;' +
    'padding:7px 14px 7px 11px;border-radius:999px;border-color:var(--线);font-weight:600;box-shadow:0 4px 16px rgba(23,32,43,.16)}' +
    '.入口 svg{width:16px;height:16px;flex:none;color:var(--主)}' +
    '.徽标{min-width:18px;padding:0 5px;border-radius:999px;background:var(--重启实);color:#3d2600;font-size:11px;line-height:18px;text-align:center;font-weight:700}' +
    '.面板{position:fixed;top:0;right:0;width:min(480px,100vw);height:100vh;height:100dvh;display:flex;flex-direction:column;' +
    'background:var(--底);border-left:1px solid var(--线);box-shadow:-12px 0 36px rgba(23,32,43,.14);outline:none;' +
    'visibility:hidden;transform:translateX(100%);transition:transform .18s ease,visibility 0s linear .18s}' +
    '.面板.打开{visibility:visible;transform:none;transition:transform .18s ease}' +
    '.头部{display:flex;align-items:center;gap:6px;padding:calc(10px + env(safe-area-inset-top,0px)) 12px 10px;background:var(--面);border-bottom:1px solid var(--线)}' +
    '.标题{flex:1;min-width:0;display:flex;flex-direction:column}' +
    '.标题 h2{margin:0;font-size:16px;font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
    '.项目{margin-left:2px;font-size:12px;font-weight:400;color:var(--弱)}' +
    '.路径{display:flex;flex-wrap:wrap;align-items:center;gap:0 2px;font-size:11.5px;color:var(--弱)}' +
    '.路径 button{border:none;background:none;padding:0 2px;border-radius:3px;color:var(--主)}.路径 button:hover:not(:disabled){background:var(--主底)}' +
    '.图标{width:32px;height:32px;padding:0;border-color:transparent;background:none;font-size:15px;color:var(--次);flex:none}' +
    '.返回{font-size:20px;line-height:1}' +
    '.搜索栏{padding:10px 12px 0}.搜索{width:100%;padding:7px 10px}' +
    '.邻组{display:flex;align-items:center;gap:6px;padding:10px 12px 0}.邻组 button{flex:1;min-width:0;text-align:left;overflow:hidden;text-overflow:ellipsis;padding:5px 8px;font-size:12px;color:var(--次)}' +
    '.邻组 .后{text-align:right}.邻组 span{flex:none;font-size:11.5px;color:var(--弱);font-variant-numeric:tabular-nums}' +
    '.目录,.列表,.交换{flex:1;overflow:auto;overscroll-behavior:contain;touch-action:pan-y;padding:12px}' +
    '.卡{background:var(--面);border:1px solid var(--线);border-radius:10px;overflow:hidden}' +
    '.目录 .卡+.卡{margin-top:12px}' +
    '.条目{display:grid;grid-template-columns:minmax(0,1fr) auto 14px;align-items:center;gap:10px;width:100%;padding:11px 12px 11px 14px;' +
    'border:none;border-bottom:1px solid var(--线);border-radius:0;background:none;text-align:left;white-space:normal}' +
    '.条目:last-child{border-bottom:none}.条目:hover:not(:disabled){background:var(--浮)}' +
    '.条目名{display:block;font-weight:550;font-size:13.5px}.条目注{display:block;font-size:11.5px;color:var(--弱);margin-top:1px}' +
    '.条目 .箭头{color:var(--弱);font-size:16px}.条目.特殊 .条目名{color:var(--主)}' +
    '.计数{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:4px}' +
    '.计数 span,.标记 span{font-size:11px;line-height:17px;padding:0 7px;border-radius:999px;white-space:nowrap}' +
    '.计数 .未应用,.标记 .未应用{color:var(--主);background:var(--主底)}.计数 .覆盖{color:var(--次);background:var(--浮)}' +
    '.计数 .待重启,.标记 .待重启{color:#3d2600;background:var(--重启实);font-weight:600}' +
    '.列表{display:flex;flex-direction:column;gap:14px}' +
    '.子组>h3{position:sticky;top:-12px;z-index:1;display:flex;align-items:center;justify-content:space-between;margin:0 -12px;padding:6px 14px;background:var(--底)}' +
    '.子组>h3 button{border:none;background:none;padding:0;font-size:12px;font-weight:600;color:var(--主)}.子组>h3 button:hover:not(:disabled){background:none;text-decoration:underline}' +
    '.子组>h3 span{font-size:11.5px;font-weight:400;color:var(--弱)}.子组.无题>h3{display:none}' +
    '.参数{display:grid;grid-template-columns:minmax(0,1fr) minmax(150px,50%);gap:6px 12px;align-items:center;padding:11px 12px 11px 14px;border-bottom:1px solid var(--线)}' +
    '.参数:last-child{border-bottom:none}.参数.宽 .控件{grid-column:1/-1}' +
    '.参数.已改{background:var(--主底)}.参数.非法{background:var(--错底)}.参数.非法 input,.参数.非法 textarea{border-color:var(--错)}' +
    '.名称{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;min-width:0}.名称 .文字{font-weight:550;overflow-wrap:anywhere}' +
    '.参数.已改 .文字::before,.参数.非法 .文字::before{content:"";display:inline-block;width:6px;height:6px;margin-right:6px;border-radius:50%;background:var(--主);vertical-align:2px}' +
    '.参数.非法 .文字::before{background:var(--错)}' +
    '.标记{display:inline-flex;flex-wrap:wrap;gap:4px}.标记 span{color:var(--次);background:var(--浮)}' +
    '.标记 .实时{color:var(--实时);background:var(--实时底)}.标记 .重启{color:var(--重启);background:var(--重启底)}' +
    '.标记 .输入有误{color:var(--错);background:var(--错底)}' +
    '.详情{grid-column:1/-1;display:flex;flex-direction:column;gap:3px;min-width:0}' +
    '.描述{margin:0;font-size:12px;line-height:1.55;color:var(--次);overflow-wrap:anywhere}' +
    '.元{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 14px;font-size:11.5px;color:var(--弱)}' +
    '.元 .项{display:inline-flex;gap:5px;align-items:baseline;white-space:nowrap}.元 .项 b{font-weight:400}' +
    '.元 .值{font-family:var(--等宽);font-variant-numeric:tabular-nums;color:var(--次)}.元 .运行 .值{color:var(--重启);font-weight:600}' +
    '.元 .键{padding:0 5px;border:none;border-radius:4px;background:var(--浮);font-family:var(--等宽);font-size:11px;color:var(--次);white-space:normal;overflow-wrap:anywhere;text-align:left}' +
    '.元 .键:hover:not(:disabled){background:var(--线);color:var(--字)}' +
    '.控件{display:flex;align-items:center;gap:8px;min-width:0}.控件 input[type=number]{width:100%}' +
    '.控件 input[type=range]{flex:1 1 auto;min-width:56px;height:18px;padding:0;margin:0;border:none;background:none;box-shadow:none;accent-color:var(--主)}' +
    '.控件 input[type=range]+input{flex:0 0 78px}.控件 select,.控件 input[type=text],.控件 textarea{width:100%}' +
    'textarea{min-height:84px;resize:vertical;font-family:var(--等宽);font-size:12px}' +
    '.分量项{flex:1 1 0;display:flex;align-items:center;gap:4px;min-width:0}.分量项 span{font:11px var(--等宽);color:var(--弱);text-transform:uppercase}' +
    '.色块{flex:none;width:26px;height:26px;border-radius:6px;border:1px solid var(--线强);background-image:linear-gradient(45deg,#d9dee5 25%,transparent 25%,transparent 75%,#d9dee5 75%),' +
    'linear-gradient(45deg,#d9dee5 25%,transparent 25%,transparent 75%,#d9dee5 75%);background-size:8px 8px;background-position:0 0,4px 4px}.色块 i{display:block;width:100%;height:100%;border-radius:5px}' +
    'input[type=checkbox].开关{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:36px;height:20px;margin:0;padding:0;' +
    'border:none;border-radius:999px;background:var(--线强);cursor:pointer;transition:background .12s}' +
    'input[type=checkbox].开关::before{content:"";position:absolute;top:3px;left:3px;width:14px;height:14px;border-radius:50%;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.2);transition:transform .12s}' +
    'input[type=checkbox].开关:checked{background:var(--主)}input[type=checkbox].开关:checked::before{transform:translateX(16px)}' +
    '.复原{flex:none;width:24px;height:24px;padding:0;border:none;background:none;color:var(--弱);font-size:14px;line-height:1}.复原:hover:not(:disabled){color:var(--字)}' +
    '.复原.隐藏{visibility:hidden}' +
    '.空{padding:32px 0;text-align:center;color:var(--弱)}' +
    '.交换 p{margin:0 0 12px;color:var(--次);font-size:12px;line-height:1.6}.交换 textarea{width:100%;min-height:220px}' +
    '.按钮组{display:grid;grid-template-columns:repeat(auto-fill,minmax(124px,1fr));gap:8px;margin:12px 0}' +
    '.文件{display:flex;align-items:center;justify-content:center;cursor:pointer;background:var(--面);border:1px solid var(--线强);border-radius:7px;padding:6px 12px}' +
    '.文件:hover{background:var(--浮)}.文件 input{display:none}' +
    '.底部{flex:none;padding:10px 12px calc(12px + env(safe-area-inset-bottom,0px));border-top:1px solid var(--线);background:var(--面)}' +
    '.摘要{display:flex;flex-wrap:wrap;gap:4px 12px;margin-bottom:4px;font-size:12px;color:var(--次)}' +
    '.摘要 b{font-weight:600;color:var(--字);font-variant-numeric:tabular-nums}.摘要 .有{color:var(--主)}.摘要 .有 b{color:var(--主)}' +
    '.摘要 .等待{color:var(--重启)}.摘要 .等待 b{color:var(--重启)}' +
    '.状态{min-height:1.5em;margin-bottom:8px;max-height:4.5em;overflow:auto;white-space:pre-wrap;font-size:12px;color:var(--弱)}' +
    '.操作{display:grid;grid-template-columns:auto 1fr auto auto;gap:8px}' +
    '@media (max-width:600px){.面板{top:auto;bottom:0;left:0;width:100%;height:84vh;height:84dvh;border-left:0;' +
    'border-top:1px solid var(--线);border-radius:14px 14px 0 0;overflow:hidden;box-shadow:0 -12px 36px rgba(23,32,43,.18);transform:translateY(100%)}' +
    '.头部{padding-top:10px}.参数{grid-template-columns:minmax(0,1fr) minmax(130px,54%)}' +
    '.操作{grid-template-columns:repeat(3,1fr)}.操作 .应用{grid-column:1/-1;order:-1}}' +
    '@media (prefers-reduced-motion:reduce){.面板,.面板.打开,button,input[type=checkbox].开关,input[type=checkbox].开关::before{transition:none}}';

/** 元信息中的取值文字：数组用逗号分隔，开关用开/关，过长截断。 */
function formatValue(value: ConfigValue): string {
    const text = Array.isArray(value) ? value.map(item => JSON.stringify(item)).join(', ')
        : typeof value === 'boolean' ? (value ? '开' : '关') : typeof value === 'string' ? (value ? '“' + value + '”' : '空') : JSON.stringify(value);
    return text.length > 60 ? text.slice(0, 59) + '…' : text;
}

/** 入口按钮的调节滑杆图标，内联 SVG，颜色跟随文字色。 */
function slidersIcon(): SVGSVGElement {
    const ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 16 16'); svg.setAttribute('aria-hidden', 'true');
    for (const [y, x] of [[4, 10], [8, 5], [12, 11]]) {
        const line = document.createElementNS(ns, 'path');
        line.setAttribute('d', 'M2 ' + y + 'H14'); line.setAttribute('stroke', 'currentColor'); line.setAttribute('stroke-width', '1.5');
        line.setAttribute('stroke-linecap', 'round'); line.setAttribute('opacity', '.55');
        const knob = document.createElementNS(ns, 'circle');
        knob.setAttribute('cx', String(x)); knob.setAttribute('cy', String(y)); knob.setAttribute('r', '2.2'); knob.setAttribute('fill', 'currentColor');
        svg.append(line, knob);
    }
    return svg;
}

/**
 * 无需 Cocos 场景节点的 Web 测试面板，适用于编辑器浏览器预览和已打包的 Web 页面。
 * 宽屏为右侧抽屉、窄屏为底部上拉面板；按分组逐级进入，末级分组显示参数，改动统一应用。
 * 原生或无 DOM 环境不创建面板，仍可使用核心及存储适配器。
 */
export class ConfigDebugPanel {
    private host: HTMLDivElement | null = null;
    private panel: HTMLDivElement | null = null;
    private entry: HTMLButtonElement | null = null;
    private badge: HTMLSpanElement | null = null;
    private backButton: HTMLButtonElement | null = null;
    private crumbs: HTMLDivElement | null = null;
    private heading: HTMLHeadingElement | null = null;
    private searchBar: HTMLDivElement | null = null;
    private search: HTMLInputElement | null = null;
    private siblings: HTMLDivElement | null = null;
    private directory: HTMLDivElement | null = null;
    private list: HTMLDivElement | null = null;
    private empty: HTMLDivElement | null = null;
    private exchange: HTMLDivElement | null = null;
    private exchangeButton: HTMLButtonElement | null = null;
    private text: HTMLTextAreaElement | null = null;
    private summary: HTMLDivElement | null = null;
    private status: HTMLDivElement | null = null;
    private applyButton: HTMLButtonElement | null = null;
    private undoButton: HTMLButtonElement | null = null;
    private resetButton: HTMLButtonElement | null = null;
    private rows: FieldRow[] = [];
    private root: GroupNode = { name: '', title: '', parent: null, children: [], rows: [], all: [], section: null };
    private view: PanelView = { kind: 'node', node: this.root };
    private exchangeOpen = false;
    private resetTimer: ReturnType<typeof setTimeout> | null = null;
    private unsubscribe: (() => void) | null = null;
    private visible = false;
    private readonly handlers: { type: string; listener: EventListener }[] = [];

    /** 保留测试会话和输入协调回调；构造本身不创建 DOM 或监听。 */
    constructor(private readonly session: ConfigTestSession, private readonly options: ConfigPanelOptions = {}) {}

    /** 创建“测试参数”入口与抽屉；关闭测试能力或没有 DOM 时返回 false，不影响游戏启动。 */
    mount(): boolean {
        if (this.host) return true;
        if (!this.session.enabled || typeof document === 'undefined' || !document.body) return false;
        const store = this.session.store;
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
        host.setAttribute('data-qx-config', store.project);
        const root = host.attachShadow({ mode: 'open' });
        const style = document.createElement('style'); style.textContent = STYLE; root.appendChild(style);
        const shell = this.element('div', '根'); root.appendChild(shell);

        this.entry = this.button('测试参数', () => this.setVisible(true), '入口');
        this.entry.prepend(slidersIcon());
        this.entry.setAttribute('aria-label', '打开测试参数'); this.entry.setAttribute('aria-expanded', 'false');
        this.badge = this.element('span', '徽标'); this.badge.hidden = true; this.entry.appendChild(this.badge);
        shell.appendChild(this.entry);

        const panel = this.element('div', '面板'); panel.tabIndex = -1;
        panel.setAttribute('role', 'dialog'); panel.setAttribute('aria-label', '测试参数');
        shell.appendChild(panel);
        const header = this.element('div', '头部'); panel.appendChild(header);
        this.backButton = this.button('‹', () => this.goBack(), '图标 返回'); this.backButton.setAttribute('aria-label', '返回上一级');
        this.backButton.title = '返回上一级（Esc）';
        const titleBox = this.element('div', '标题');
        this.crumbs = this.element('div', '路径'); this.crumbs.setAttribute('aria-label', '当前位置');
        this.heading = document.createElement('h2');
        titleBox.append(this.crumbs, this.heading);
        this.exchangeButton = this.button('导入导出', () => this.showExchange(!this.exchangeOpen));
        this.exchangeButton.setAttribute('aria-pressed', 'false');
        const close = this.button('✕', () => this.setVisible(false), '图标'); close.setAttribute('aria-label', '关闭'); close.title = '关闭';
        header.append(this.backButton, titleBox, this.exchangeButton, close);

        this.searchBar = this.element('div', '搜索栏');
        this.search = document.createElement('input'); this.search.type = 'search'; this.search.className = '搜索';
        this.search.placeholder = '搜索标题、分组或参数键'; this.search.setAttribute('aria-label', '搜索参数');
        this.search.addEventListener('input', () => this.render(false));
        this.searchBar.appendChild(this.search); panel.appendChild(this.searchBar);
        this.siblings = this.element('div', '邻组'); panel.appendChild(this.siblings);
        this.directory = this.element('div', '目录'); this.directory.setAttribute('aria-label', '参数分组'); panel.appendChild(this.directory);
        this.list = this.element('div', '列表'); panel.appendChild(this.list);
        this.empty = this.element('div', '空'); this.empty.hidden = true;
        this.exchange = this.buildExchange(); this.exchange.hidden = true; panel.appendChild(this.exchange);

        const footer = this.element('div', '底部'); panel.appendChild(footer);
        this.summary = this.element('div', '摘要'); this.summary.setAttribute('aria-live', 'polite'); footer.appendChild(this.summary);
        this.status = this.element('div', '状态'); this.status.setAttribute('role', 'status'); footer.appendChild(this.status);
        const actions = this.element('div', '操作'); footer.appendChild(actions);
        this.undoButton = this.button('撤销', () => this.undo()); this.undoButton.title = '把未应用的输入恢复为当前目标值';
        this.applyButton = this.button('应用改动', () => this.run(() => this.reportApply(this.apply())), '应用');
        this.applyButton.title = '提交全部未应用的改动（Ctrl+Enter）';
        const save = this.button('保存到本机', () => this.run(() => { this.apply(); this.session.save(); this.report('已保存改动，下次打开生效'); }));
        this.resetButton = this.button('恢复项目参数', () => this.confirmReset());
        actions.append(this.undoButton, this.applyButton, save, this.resetButton);

        this.buildRows();
        // 阻止面板内事件冒泡到游戏的全局监听；捕获阶段输入由项目的可见性回调协调暂停。
        for (const type of ['pointerdown', 'pointermove', 'pointerup', 'pointercancel', 'touchstart', 'touchmove', 'touchend', 'touchcancel',
            'mousedown', 'mousemove', 'mouseup', 'click', 'dblclick', 'wheel', 'keydown', 'keyup']) {
            const listener: EventListener = event => event.stopPropagation();
            host.addEventListener(type, listener);
            this.handlers.push({ type, listener });
        }
        panel.addEventListener('keydown', event => this.shortcut(event));
        this.host = host; this.panel = panel; document.body.appendChild(host);
        this.unsubscribe = store.subscribe(snapshot => { this.sync(snapshot); this.report('配置已更新'); });
        this.sync(store.snapshot()); this.render(true); this.report('参数已加载');
        if (this.session.panelRequested) this.setVisible(true);
        return true;
    }

    /** 显示或收起面板；不擅自暂停引擎或清除项目已有的其他暂停状态。未应用的输入与所在分组在收起后保留。 */
    setVisible(visible: boolean): void {
        if (!this.panel || this.visible === visible) return;
        this.visible = visible;
        this.panel.classList.toggle('打开', visible);
        this.entry!.hidden = visible; this.entry!.setAttribute('aria-expanded', String(visible));
        if (visible) this.panel.focus({ preventScroll: true });
        try { this.options.onVisibilityChange?.(visible); }
        catch (error) { this.report('项目输入协调回调失败：' + message(error)); }
    }

    /** 解除订阅与事件并删除自身节点，供场景退出或预览结束调用。 */
    dispose(): void {
        this.setVisible(false);
        this.unsubscribe?.(); this.unsubscribe = null;
        if (this.resetTimer !== null) clearTimeout(this.resetTimer);
        this.resetTimer = null;
        for (const { type, listener } of this.handlers) this.host?.removeEventListener(type, listener);
        this.handlers.length = 0;
        this.host?.remove(); this.host = null; this.panel = null; this.entry = null; this.badge = null;
        this.backButton = null; this.crumbs = null; this.heading = null; this.searchBar = null; this.search = null; this.siblings = null;
        this.directory = null; this.list = null; this.empty = null; this.exchange = null; this.exchangeButton = null; this.text = null;
        this.summary = null; this.status = null; this.applyButton = null; this.undoButton = null; this.resetButton = null;
        this.rows = [];
        this.root = { name: '', title: '', parent: null, children: [], rows: [], all: [], section: null };
        this.view = { kind: 'node', node: this.root };
    }

    /** 按声明一次创建分组树与全部行；分组路径按“·”拆为逐级节点，每个含字段的节点对应一个参数区块。 */
    private buildRows(): void {
        for (const [key, field] of this.session.store.fields()) {
            let node = this.root;
            for (const part of (field.group || UNGROUPED).split('·')) {
                let child = node.children.find(item => item.name === part);
                if (!child) {
                    child = { name: part, title: node.title ? node.title + ' · ' + part : part, parent: node, children: [], rows: [], all: [], section: null };
                    node.children.push(child);
                }
                node = child;
            }
            if (!node.section) node.section = this.buildSection(node);
            const name = (field.group ? field.group + ' / ' : '') + field.label;
            const element = this.element('div', '参数'); element.dataset.key = key;
            if (field.kind === '向量' || field.kind === '数据') element.classList.add('宽');
            const head = this.element('div', '名称');
            const label = this.element('span', '文字'); label.textContent = field.label;
            const marks = this.element('span', '标记');
            head.append(label, marks);
            const restore = this.button('↺', () => {}, '复原');
            restore.setAttribute('aria-label', '恢复默认：' + name); restore.title = '恢复声明默认值（需应用）';
            const control = this.control(field, name); control.element.classList.add('控件'); control.element.appendChild(restore);
            const details = this.element('div', '详情'), note = this.element('div', '元');
            if (field.description) { const text = document.createElement('p'); text.className = '描述'; text.textContent = field.description; details.appendChild(text); }
            details.appendChild(note);
            element.append(head, control.element, details);
            node.section.lastElementChild!.appendChild(element);
            const row: FieldRow = { key, field, node, search: [key, field.label, field.group || ''].join(' ').toLowerCase(),
                element, control, marks, note, restore, dirty: false, invalid: false };
            restore.addEventListener('click', () => { control.write(field.defaultValue); this.touch(row); });
            element.addEventListener('input', () => this.touch(row));
            element.addEventListener('change', () => this.touch(row));
            node.rows.push(row);
            for (let item: GroupNode | null = node; item; item = item.parent) item.all.push(row);
            this.rows.push(row);
        }
        for (const node of this.walk(this.root)) {
            if (node.section) node.section.querySelector('h3 span')!.textContent = node.rows.length + ' 项';
        }
        this.list!.appendChild(this.empty!);
    }

    /** 创建参数区块：标题可点击进入该分组（搜索与“已修改”视图中使用），参数放在白色卡片内。 */
    private buildSection(node: GroupNode): HTMLDivElement {
        const section = this.element('div', '子组'), heading = document.createElement('h3');
        const go = this.button(node.title, () => this.open(node)); go.title = '进入该分组';
        heading.append(go, this.element('span'));
        section.append(heading, this.element('div', '卡'));
        this.list!.appendChild(section);
        return section;
    }

    /** 深度优先列出节点。 */
    private walk(node: GroupNode): GroupNode[] {
        return [node].concat(...node.children.map(child => this.walk(child)));
    }

    /** 进入分组：只有一个下级且本级无字段的中间层自动跳过。 */
    private enter(node: GroupNode): void {
        while (node !== this.root && node.children.length === 1 && !node.rows.length) node = node.children[0];
        this.view = { kind: 'node', node }; this.clearSearch(); this.render(true);
    }

    /** 打开字段所在的参数页；混合分组打开其本级参数。 */
    private open(node: GroupNode): void {
        if (node.children.length) { this.view = { kind: 'own', node }; this.clearSearch(); this.render(true); }
        else this.enter(node);
    }

    /** 返回上一级，跳过被自动跳过的中间层。 */
    private goBack(): void {
        const view = this.view;
        if (view.kind === 'changed') { this.enter(this.root); return; }
        if (view.kind === 'own') { this.enter(view.node); return; }
        let parent = view.node.parent;
        while (parent && parent !== this.root && parent.children.length === 1 && !parent.rows.length) parent = parent.parent;
        this.enter(parent || this.root);
    }

    /** 当前是否位于目录首页。 */
    private atRoot(): boolean { return this.view.kind === 'node' && this.view.node === this.root; }

    /** 当前是否为显示参数的页面（末级分组、本级参数或已修改）。 */
    private showsRows(): boolean {
        const view = this.view;
        return view.kind !== 'node' || view.node.children.length === 0;
    }

    /** 清空搜索词。 */
    private clearSearch(): void { if (this.search) this.search.value = ''; }

    /** 按当前页面刷新头部、目录、邻组导航与参数可见性；切换页面时回到顶部。 */
    private render(resetScroll: boolean): void {
        if (!this.panel) return;
        const view = this.view, query = this.query(), rowsMode = !!query || this.showsRows();
        this.backButton!.hidden = this.atRoot();
        const node = view.kind === 'changed' ? null : view.node;
        this.heading!.replaceChildren(document.createTextNode(this.atRoot() ? '测试参数' : view.kind === 'changed' ? '已修改' :
            view.kind === 'own' ? node!.name + ' · 本级参数' : node!.name));
        if (this.atRoot()) { const project = this.element('span', '项目'); project.textContent = ' · ' + this.session.store.project; this.heading!.appendChild(project); }
        const trail: GroupNode[] = [];
        if (!this.atRoot()) {
            for (let item = view.kind === 'node' ? node!.parent : view.kind === 'own' ? node : this.root; item; item = item.parent) trail.unshift(item);
        }
        this.crumbs!.hidden = !trail.length;
        this.crumbs!.replaceChildren(...trail.reduce<Node[]>((nodes, item, i) => {
            const crumb = this.button(item === this.root ? '测试参数' : item.name, () => this.enter(item));
            return nodes.concat(i ? [document.createTextNode('›'), crumb] : [crumb]);
        }, []));
        this.renderSiblings(!query);
        this.directory!.hidden = this.exchangeOpen || rowsMode;
        this.list!.hidden = this.exchangeOpen || !rowsMode;
        this.searchBar!.hidden = this.exchangeOpen;
        if (!rowsMode) this.renderDirectory();
        else this.filter();
        if (resetScroll) { this.directory!.scrollTop = 0; this.list!.scrollTop = 0; }
    }

    /** 末级分组页显示同级的上一组与下一组，便于在结构相同的分组间切换。 */
    private renderSiblings(allowed: boolean): void {
        const view = this.view, bar = this.siblings!;
        const node = view.kind === 'node' && !view.node.children.length ? view.node : null;
        const peers = node?.parent ? node.parent.children : [];
        bar.hidden = this.exchangeOpen || !allowed || !node || peers.length < 2;
        if (bar.hidden || !node) { bar.replaceChildren(); return; }
        const index = peers.indexOf(node), prev = peers[index - 1], next = peers[index + 1];
        const before = this.button('‹ ' + (prev ? prev.name : '无'), () => prev && this.enter(prev)), after = this.button((next ? next.name : '无') + ' ›', () => next && this.enter(next), '后');
        before.disabled = !prev; after.disabled = !next;
        before.setAttribute('aria-label', prev ? '上一组：' + prev.name : '没有上一组');
        after.setAttribute('aria-label', next ? '下一组：' + next.name : '没有下一组');
        const position = this.element('span'); position.textContent = (index + 1) + ' / ' + peers.length;
        bar.replaceChildren(before, position, after);
    }

    /** 生成目录页：首页带“已修改”入口；混合分组带“本级参数”入口；每项显示数量与改动标记。 */
    private renderDirectory(): void {
        const view = this.view, snapshot = this.session.store.snapshot();
        if (view.kind !== 'node') return;
        const node = view.node, cards: HTMLDivElement[] = [];
        if (node === this.root) {
            const changed = this.rows.filter(row => this.changed(row, snapshot));
            const card = this.element('div', '卡');
            card.appendChild(this.entryButton('已修改', '未应用的输入，以及本机保存或本次会话的覆盖', changed, () => { this.view = { kind: 'changed' }; this.clearSearch(); this.render(true); }, true));
            cards.push(card);
        }
        const card = this.element('div', '卡');
        if (node.rows.length && node.children.length) card.appendChild(this.entryButton('本级参数', node.rows.length + ' 项', node.rows, () => this.open(node), true));
        for (const child of node.children) {
            const groups = child.children.length, note = (groups ? groups + ' 组 · ' : '') + child.all.length + ' 项';
            card.appendChild(this.entryButton(child.name, note, child.all, () => this.enter(child)));
        }
        cards.push(card);
        this.directory!.replaceChildren(...cards);
    }

    /** 目录中的一项：名称、说明、未应用/覆盖/待重启计数与箭头。 */
    private entryButton(name: string, note: string, rows: FieldRow[], action: () => void, special = false): HTMLButtonElement {
        const snapshot = this.session.store.snapshot(), button = this.button('', action, '条目' + (special ? ' 特殊' : ''));
        button.setAttribute('aria-label', name);
        const text = this.element('span'), title = this.element('span', '条目名'), detail = this.element('span', '条目注');
        title.textContent = name; detail.textContent = note; text.append(title, detail);
        const counts = this.element('span', '计数');
        const dirty = rows.filter(row => row.dirty).length;
        const overridden = rows.filter(row => { const source = snapshot.sources[row.key]; return source === '本地' || source === '会话'; }).length;
        const pending = rows.filter(row => snapshot.pendingRestart.indexOf(row.key) !== -1).length;
        for (const [count, label, className] of [[dirty, '未应用', '未应用'], [overridden, '已覆盖', '覆盖'], [pending, '待重启', '待重启']] as [number, string, string][]) {
            if (!count) continue;
            const tag = this.element('span', className); tag.textContent = count + ' ' + label; counts.appendChild(tag);
        }
        const arrow = this.element('span', '箭头'); arrow.textContent = '›'; arrow.setAttribute('aria-hidden', 'true');
        button.append(text, counts, arrow);
        return button;
    }

    /** 创建导入导出页：文本框与低频操作集中在此，不占用调参视图。 */
    private buildExchange(): HTMLDivElement {
        const page = this.element('div', '交换');
        const note = document.createElement('p');
        note.textContent = '粘贴或选择配置 JSON 后导入到本次会话；导出、下载与复现链接会先应用未提交的改动。“改动”只含相对项目参数的差异。';
        page.appendChild(note);
        this.text = document.createElement('textarea'); this.text.maxLength = CONFIG_TEXT_LIMIT;
        this.text.placeholder = '在此粘贴配置 JSON；导出的 JSON 或复现链接也显示在此';
        this.text.setAttribute('aria-label', '配置导入导出内容'); page.appendChild(this.text);
        const group = this.element('div', '按钮组'); page.appendChild(group);
        group.appendChild(this.button('导入 JSON', () => this.run(() => this.reportImport(this.session.store.importDocument(this.text!.value), 'JSON 已导入'))));
        const file = document.createElement('label'); file.className = '文件'; file.textContent = '选择文件';
        const upload = document.createElement('input'); upload.type = 'file'; upload.accept = '.json,application/json';
        upload.setAttribute('aria-label', '选择配置 JSON 文件');
        upload.addEventListener('change', () => this.readFile(upload));
        file.appendChild(upload); group.appendChild(file);
        group.appendChild(this.button('导出改动', () => this.run(() => this.exportText('改动'))));
        group.appendChild(this.button('导出全部', () => this.run(() => this.exportText('全部'))));
        group.appendChild(this.button('下载 JSON', () => this.run(() => { this.apply(); this.download(); })));
        group.appendChild(this.button('生成复现链接', () => this.run(() => {
            this.apply(); this.text!.value = this.session.shareURL(); this.report('链接已生成，只携带相对项目参数的改动；打开后按目标值启动');
        })));
        group.appendChild(this.button('复制文本', () => this.copy()));
        return page;
    }

    /** 读取选择的配置文件并导入，文件过大或读取失败时只提示。 */
    private readFile(upload: HTMLInputElement): void {
        const file = upload.files?.[0];
        if (!file) return;
        if (file.size > CONFIG_TEXT_LIMIT * 4) { this.report('文件过大，请导入小于 256K 的 JSON'); upload.value = ''; return; }
        const reader = new FileReader();
        reader.onload = () => {
            if (!this.host) return;
            this.run(() => {
                const issues = this.session.store.importDocument(String(reader.result));
                this.text!.value = String(reader.result);
                this.reportImport(issues, '文件已导入');
            });
            upload.value = '';
        };
        reader.onerror = () => { if (this.host) this.report('文件读取失败，请直接粘贴 JSON'); };
        reader.readAsText(file);
    }

    /** 切换调参页面与导入导出页。 */
    private showExchange(open: boolean): void {
        this.exchangeOpen = open;
        this.exchange!.hidden = !open;
        this.exchangeButton!.textContent = open ? '返回参数' : '导入导出';
        this.exchangeButton!.setAttribute('aria-pressed', String(open));
        this.render(false);
    }

    /** 按字段类型生成控件；新增字段类型时与容器的校验表各加一项。 */
    private control(field: ConfigField, name: string): FieldControl {
        switch (field.kind) {
            case '开关': {
                const input = document.createElement('input'); input.type = 'checkbox'; input.className = '开关';
                input.setAttribute('role', 'switch'); input.setAttribute('aria-label', name);
                const box = this.element('div'); box.appendChild(input);
                return { element: box, focus: input, read: () => input.checked, write: value => { input.checked = value as boolean; } };
            }
            case '选项': {
                const select = document.createElement('select'); select.setAttribute('aria-label', name);
                for (const choice of field.choices) { const option = document.createElement('option'); option.value = choice; option.textContent = choice; select.appendChild(option); }
                const box = this.element('div'); box.appendChild(select);
                return { element: box, focus: select, read: () => select.value, write: value => { select.value = String(value); } };
            }
            case '数据': {
                const input = document.createElement('textarea'); input.maxLength = CONFIG_TEXT_LIMIT; input.setAttribute('aria-label', name);
                const box = this.element('div'); box.appendChild(input);
                return { element: box, focus: input, write: value => { input.value = JSON.stringify(value, null, 2); }, read: () => {
                    try { return JSON.parse(input.value) as ConfigValue; }
                    catch { throw new Error(field.label + ' 不是有效的 JSON'); }
                } };
            }
            case '向量': {
                const box = this.element('div');
                const color = field.components.join() === 'r,g,b,a', swatch = color ? document.createElement('i') : null;
                if (swatch) { const frame = this.element('span', '色块'); frame.appendChild(swatch); box.appendChild(frame); }
                const inputs = field.components.map(component => {
                    const item = document.createElement('label'); item.className = '分量项';
                    const tag = this.element('span'); tag.textContent = component;
                    const input = this.numberInput(field); input.setAttribute('aria-label', name + ' ' + component);
                    item.append(tag, input); box.appendChild(item); return input;
                });
                const paint = () => {
                    if (!swatch) return;
                    const [r, g, b, a] = inputs.map(input => Number(input.value) || 0);
                    swatch.style.background = 'rgba(' + r + ',' + g + ',' + b + ',' + a / 255 + ')';
                };
                box.addEventListener('input', paint);
                return { element: box, focus: inputs[0],
                    read: () => inputs.map((input, i) => this.readNumber(input, field.label + ' ' + field.components[i])),
                    write: value => { inputs.forEach((input, i) => { input.value = String((value as number[])[i]); }); paint(); } };
            }
            case '数值': {
                const box = this.element('div');
                const input = this.numberInput(field); input.setAttribute('aria-label', name);
                let slider: HTMLInputElement | null = null;
                if (field.min !== undefined && field.max !== undefined && field.max - field.min <= SLIDER_SPAN) {
                    const range = document.createElement('input'); range.type = 'range';
                    range.min = String(field.min); range.max = String(field.max);
                    range.step = String(field.step ?? (field.integer ? 1 : 'any')); range.setAttribute('aria-label', name + ' 滑块');
                    range.addEventListener('input', () => { input.value = range.value; });
                    input.addEventListener('input', () => { if (input.value.trim() && Number.isFinite(Number(input.value))) range.value = input.value; });
                    box.appendChild(range); slider = range;
                }
                box.appendChild(input);
                return { element: box, focus: input, read: () => this.readNumber(input, field.label),
                    write: value => { input.value = String(value); if (slider) slider.value = String(value); } };
            }
            default: {
                const input = document.createElement('input'); input.type = 'text'; input.maxLength = field.maxLength ?? 1024;
                input.setAttribute('aria-label', name);
                const box = this.element('div'); box.appendChild(input);
                return { element: box, focus: input, read: () => input.value, write: value => { input.value = String(value); } };
            }
        }
    }

    /** 创建带范围与步长的数字输入框。 */
    private numberInput(field: { min?: number; max?: number; step?: number; integer?: boolean }): HTMLInputElement {
        const input = document.createElement('input'); input.type = 'number';
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        input.step = String(field.step ?? (field.integer ? 1 : 'any'));
        return input;
    }

    /** 读取数字输入，空值或非数字直接报错而不当作零。 */
    private readNumber(input: HTMLInputElement, label: string): number {
        const value = Number(input.value);
        if (!input.value.trim() || !Number.isFinite(value)) throw new Error(label + ' 不能为空且必须是数字');
        return value;
    }

    /** 输入后重新判断该行是否与目标值不同；无法读取的输入标为非法，底部摘要随之更新。 */
    private touch(row: FieldRow): void {
        const snapshot = this.session.store.snapshot();
        this.check(row, snapshot);
        this.refreshRow(row, snapshot); this.refreshCounts(snapshot);
    }

    /** 比较控件与目标值，更新未应用和非法状态。 */
    private check(row: FieldRow, snapshot: ConfigSnapshot): void {
        try { row.dirty = !configEqual(row.control.read(), snapshot.desired[row.key]); row.invalid = false; }
        catch { row.dirty = true; row.invalid = true; }
    }

    /** 配置变化后只刷新显示：未修改的控件跟随目标值，未应用的输入保留。 */
    private sync(snapshot: ConfigSnapshot): void {
        for (const row of this.rows) {
            if (row.dirty) this.check(row, snapshot);
            if (!row.dirty) row.control.write(snapshot.desired[row.key]);
            this.refreshRow(row, snapshot);
        }
        this.refreshCounts(snapshot);
        if (this.view.kind === 'changed' || this.query()) this.filter();
    }

    /** 刷新行标记与元信息：生效时机、非默认来源、未应用、待重启及范围。 */
    private refreshRow(row: FieldRow, snapshot: ConfigSnapshot): void {
        const { field, key } = row, source = snapshot.sources[key], pending = snapshot.pendingRestart.indexOf(key) !== -1;
        row.element.classList.toggle('已改', row.dirty && !row.invalid);
        row.element.classList.toggle('非法', row.invalid);
        const marks: [string, string][] = [[field.timing || '重启', field.timing === '实时' ? '实时' : '重启']];
        if (source !== '默认') marks.push([source, '来源']);
        if (pending) marks.push(['待重启', '待重启']);
        if (row.dirty) marks.push(row.invalid ? ['输入有误', '输入有误'] : ['未应用', '未应用']);
        row.marks.replaceChildren(...marks.map(([text, className]) => { const tag = this.element('span', className); tag.textContent = text; return tag; }));
        row.restore.classList.toggle('隐藏', !row.dirty && configEqual(snapshot.desired[key], field.defaultValue));
        const keyButton = this.button(key, () => this.copyKey(key), '键'); keyButton.title = '点击复制参数键';
        const items: HTMLElement[] = [keyButton];
        const limits = field.kind === '数值' || field.kind === '向量' ? field : null;
        if (limits && (limits.min !== undefined || limits.max !== undefined))
            items.push(this.metaItem('范围', (limits.min ?? '−∞') + ' – ' + (limits.max ?? '∞')));
        if (limits?.step !== undefined) items.push(this.metaItem('步长', String(limits.step)));
        else if (limits?.integer) items.push(this.metaItem('取值', '整数'));
        if (field.kind === '文本' && field.maxLength !== undefined) items.push(this.metaItem('最长', field.maxLength + ' 字'));
        if (field.kind !== '数据') items.push(this.metaItem('默认', formatValue(field.defaultValue)));
        if (pending) items.push(this.metaItem('本局仍为', formatValue(snapshot.active[key]), '运行'));
        row.note.replaceChildren(...items);
    }

    /** 生成一个“标签 + 值”的元信息项。 */
    private metaItem(label: string, value: string, className = ''): HTMLSpanElement {
        const item = this.element('span', '项 ' + className), name = document.createElement('b'), text = this.element('span', '值');
        name.textContent = label; text.textContent = value; item.append(name, text); return item;
    }

    /** 复制参数键，便于在 JSON 或代码中定位；剪贴板不可用时只提示键名。 */
    private copyKey(key: string): void {
        const done = () => this.report('已复制参数键 ' + key), fail = () => this.report('参数键：' + key + '（当前环境不允许写入剪贴板）');
        try { if (navigator.clipboard) navigator.clipboard.writeText(key).then(done, fail); else fail(); }
        catch { fail(); }
    }

    /** 刷新底部摘要、应用按钮、入口徽标与目录计数；每次输入、应用、撤销或外部变化后调用。 */
    private refreshCounts(snapshot: ConfigSnapshot): void {
        const dirtyRows = this.rows.filter(row => row.dirty), dirty = dirtyRows.length;
        const live = dirtyRows.filter(row => row.field.timing === '实时').length, invalid = dirtyRows.filter(row => row.invalid).length;
        const pending = snapshot.pendingRestart.length;
        const overridden = this.rows.filter(row => { const source = snapshot.sources[row.key]; return source === '本地' || source === '会话'; }).length;
        const items: HTMLSpanElement[] = [];
        const item = (parts: (string | number)[], className = '') => {
            const span = this.element('span', className);
            parts.forEach((part, i) => { if (i % 2) { const b = document.createElement('b'); b.textContent = String(part); span.appendChild(b); } else span.appendChild(document.createTextNode(String(part))); });
            items.push(span);
        };
        if (dirty) item(['未应用 ', dirty, ' 项（实时 ' + live + ' · 重启 ' + (dirty - live) + (invalid ? ' · 有误 ' + invalid : '') + '）'], '有');
        else item(['没有未应用的输入']);
        item(['待重启 ', pending, ' 项'], pending ? '等待' : '');
        item(['已覆盖 ', overridden, ' 项']);
        this.summary!.replaceChildren(...items);
        this.summary!.title = pending ? '待重启参数在刷新页面或重新进入后生效；刷新前先保存到本机，或用复现链接打开' : '';
        this.applyButton!.textContent = dirty ? '应用 ' + dirty + ' 项改动' : '应用改动';
        this.applyButton!.classList.toggle('主', dirty > 0);
        this.undoButton!.disabled = dirty === 0;
        this.badge!.hidden = pending === 0; this.badge!.textContent = String(pending);
        this.badge!.title = pending + ' 项等待重启';
        if (!this.directory!.hidden) this.renderDirectory();
    }

    /** “已修改”包含未应用输入及本地或本次会话的覆盖。 */
    private changed(row: FieldRow, snapshot: ConfigSnapshot): boolean {
        const source = snapshot.sources[row.key];
        return row.dirty || source === '本地' || source === '会话';
    }

    /** 只提交未应用的改动，读取失败时定位到出错控件；整批校验保证跨字段关系不出现短暂非法状态。 */
    private apply(): ConfigUpdateResult {
        const desired = this.session.store.snapshot().desired;
        const changes: Record<string, ConfigValue> = Object.create(null);
        for (const row of this.rows) {
            if (!row.dirty) continue;
            let value: ConfigValue;
            try { value = row.control.read(); }
            catch (error) { this.reveal(row); throw error; }
            if (!configEqual(value, desired[row.key])) changes[row.key] = value;
        }
        if (!Object.keys(changes).length) return { changed: false, deferred: false };
        return this.session.store.patchLayer('会话', changes);
    }

    /** 把全部未应用输入恢复为当前目标值。 */
    private undo(): void {
        const snapshot = this.session.store.snapshot();
        let count = 0;
        for (const row of this.rows) {
            if (!row.dirty) continue;
            row.control.write(snapshot.desired[row.key]); row.dirty = false; row.invalid = false; count++;
            this.refreshRow(row, snapshot);
        }
        this.refreshCounts(snapshot);
        if (this.view.kind === 'changed') this.filter();
        this.report('已撤销 ' + count + ' 项未应用的输入');
    }

    /** 清除本地与会话覆盖前需在三秒内再次点击确认，避免误删保存。 */
    private confirmReset(): void {
        const button = this.resetButton!;
        if (this.resetTimer === null) {
            button.textContent = '再次点击确认清除'; button.classList.add('确认');
            this.resetTimer = setTimeout(() => this.clearResetConfirm(), 3000);
            return;
        }
        this.clearResetConfirm();
        this.run(() => {
            for (const row of this.rows) { row.dirty = false; row.invalid = false; }
            const issues = this.session.reset();
            // 覆盖本已为空时容器不会通知，仍需把清除的草稿换回目标值。
            this.sync(this.session.store.snapshot());
            this.report(['已清除测试覆盖', ...issues].join('\n'));
        });
    }

    /** 撤销确认状态。 */
    private clearResetConfirm(): void {
        if (this.resetTimer !== null) clearTimeout(this.resetTimer);
        this.resetTimer = null;
        if (this.resetButton) { this.resetButton.textContent = '恢复项目参数'; this.resetButton.classList.remove('确认'); }
    }

    /** 进入出错行所在分组并聚焦其控件。 */
    private reveal(row: FieldRow): void {
        if (this.exchangeOpen) this.showExchange(false);
        if (row.element.hidden || this.list!.hidden) this.open(row.node);
        row.control.focus.focus({ preventScroll: true });
        row.element.scrollIntoView({ block: 'nearest' });
    }

    /** 面板内快捷键：Esc 依次关闭导入导出页、清空搜索、返回上一级，首页时关闭面板；Ctrl/Cmd+Enter 应用。 */
    private shortcut(event: KeyboardEvent): void {
        if (event.key === 'Escape') {
            event.preventDefault();
            if (this.exchangeOpen) this.showExchange(false);
            else if (this.query()) { this.clearSearch(); this.render(false); }
            else if (!this.atRoot()) this.goBack();
            else this.setVisible(false);
        } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) { event.preventDefault(); this.run(() => this.reportApply(this.apply())); }
    }

    /** 按应用结果提示：无改动、正常应用或整体推迟到重启。 */
    private reportApply(result: ConfigUpdateResult): void {
        if (!result.changed) this.report('没有改动');
        else if (result.deferred) this.report('参数已作为重启生效保存：本次改动中的实时参数与本局重启参数组合不合法，已整体推迟到重启');
        else this.report('参数已应用');
    }

    /** 提示导入结果，并列出宽松导入跳过的内容。 */
    private reportImport(issues: readonly string[], text: string): void {
        this.report([text, ...issues].join('\n'));
    }

    /** 先应用面板输入，再把指定范围的配置写入文本框。 */
    private exportText(scope: ConfigExportScope): void {
        this.apply(); this.text!.value = this.session.store.exportJSON(scope);
        this.report(scope === '改动' ? '已导出相对项目参数的改动，可复制或下载' : '已导出完整目标值，可作为项目配置文件');
    }

    /** 复制文本框内容；剪贴板不可用时选中文本，提示手动复制。 */
    private copy(): void {
        const text = this.text!;
        if (!text.value) { this.report('没有可复制的内容，请先导出或生成链接'); return; }
        const fallback = () => { text.focus(); text.select(); this.report('已选中文本，请手动复制'); };
        try {
            if (!navigator.clipboard) { fallback(); return; }
            navigator.clipboard.writeText(text.value).then(() => this.report('已复制到剪贴板'), fallback);
        } catch { fallback(); }
    }

    /** 当前搜索词。 */
    private query(): string { return this.search?.value.trim().toLowerCase() || ''; }

    /** 参数页的可见行：搜索跨全部分组；“已修改”按改动筛选；末级与本级参数页只显示该分组。区块标题仅在跨分组时显示。 */
    private filter(): void {
        if (!this.list) return;
        const query = this.query(), view = this.view, snapshot = this.session.store.snapshot(), visible = new Set<GroupNode>();
        const crossGroup = !!query || view.kind === 'changed';
        for (const row of this.rows) {
            const show = query ? row.search.indexOf(query) !== -1
                : view.kind === 'changed' ? this.changed(row, snapshot) : row.node === view.node;
            row.element.hidden = !show;
            if (show) visible.add(row.node);
        }
        for (const node of this.walk(this.root)) {
            if (!node.section) continue;
            node.section.hidden = !visible.has(node);
            node.section.classList.toggle('无题', !crossGroup);
        }
        this.empty!.hidden = visible.size > 0;
        this.empty!.textContent = query ? '没有匹配的参数' : view.kind === 'changed' ? '没有未应用的输入或覆盖' : '没有参数';
    }

    /** 生成标准按钮，统一使用显式点击行为，不注册全局快捷键。 */
    private button(label: string, action: () => void, className = ''): HTMLButtonElement {
        const button = document.createElement('button'); button.type = 'button'; button.textContent = label; button.className = className;
        button.addEventListener('click', action); return button;
    }

    /** 创建普通容器，使用文本节点展示外部输入，避免把配置当作 HTML。 */
    private element<K extends 'div' | 'span'>(tag: K, className = ''): HTMLElementTagNameMap[K] {
        const node = document.createElement(tag); node.className = className; return node;
    }

    /** 下载相对项目参数的改动，并及时释放临时对象地址。 */
    private download(): void {
        const blob = new Blob([this.session.store.exportJSON('改动')], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const anchor = document.createElement('a'); anchor.href = url;
        anchor.download = this.session.store.project.replace(/[^a-zA-Z0-9_一-鿿-]/g, '_') + '-测试配置.json';
        // 下载产生的合成点击也必须留在面板事件边界内，避免传给游戏的全局点击监听。
        this.panel!.appendChild(anchor); anchor.click(); anchor.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        this.report('已发起改动 JSON 下载；若环境限制下载，可用导出改动复制文本');
    }

    /** 在面板内显示失败，保留现有游戏和上一份有效参数。 */
    private run(action: () => void): void {
        try { action(); } catch (error) { this.report(message(error)); }
    }

    /** 显示中文状态消息，保留换行便于阅读多个诊断；计数类信息由底部摘要实时呈现。 */
    private report(text: string): void { if (this.status) this.status.textContent = text; }
}
