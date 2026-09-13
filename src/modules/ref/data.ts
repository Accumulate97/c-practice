/**
 * 速查手册语料（任务 3-3）：printf/scanf 格式符、运算符优先级、ASCII、关键字、常用库函数。
 *
 * ── 为什么是 TS 模块而不是 public/data/ref/*.json ───────────────────────
 * ①「禁手写 JSON」针对的是**重复性语料**（步骤快照、128 行 ASCII），这类内容本页一律程序化生成：
 *   ASCII 表由 charCode 循环产出，控制字符名走一张 33 项小表；库函数按头文件分组后由同一个渲染器出表。
 * ② 真正需要人写的只有「知识本身」（格式符含义、优先级、坑），写成 TS 常量比 JSON 更好：
 *   有类型检查、能写注释说明出处、跟着 /cheatsheet 这条 lazy 路由进独立 chunk，首页零体积。
 * ③ 少一个 fetch、少一份可能与代码不同步的数据文件。
 *
 * 依据：C99（本站编译口径 -std=c99 -Wall -Wextra）。C++ 专属内容一律不收。
 */

export interface RefColumn {
  key: string
  label: string
  /** 等宽字体列（代码 / 原型 / 字符） */
  mono?: boolean
  /** 该列不参与搜索匹配（如纯符号列，搜了没意义） */
  noSearch?: boolean
}

export type RefRow = Record<string, string>

export interface RefTable {
  id: string
  title: string
  /** 表格无障碍名（<caption> 用），必须写清楚，a11y 专项会查 */
  caption: string
  note?: string
  columns: RefColumn[]
  rows: RefRow[]
}

export interface RefTip {
  title: string
  body: string
}

export interface RefSection {
  id: string
  emoji: string
  title: string
  intro?: string
  tables: RefTable[]
  tips?: RefTip[]
}

/* ══════════════ 1. printf / scanf 格式符 ══════════════ */

const printfCols: RefColumn[] = [
  { key: 'spec', label: '格式符', mono: true },
  { key: 'mean', label: '含义' },
  { key: 'arg', label: '对应实参类型', mono: true },
  { key: 'demo', label: '示例', mono: true },
  { key: 'out', label: '输出', mono: true },
  { key: 'trap', label: '坑 / 备注' },
]

const printfRows: RefRow[] = [
  { spec: '%d 或 %i', mean: '十进制有符号整数', arg: 'int', demo: 'printf("%d", -42)', out: '-42', trap: '实参若是 long 要用 %ld；给 %d 传 double 是未定义行为' },
  { spec: '%u', mean: '十进制无符号整数', arg: 'unsigned int', out: '4294967295', demo: 'printf("%u", -1u)', trap: '打印 -1 会得到 UINT_MAX，不会报错' },
  { spec: '%o', mean: '八进制（无符号）', arg: 'unsigned int', demo: 'printf("%o", 8)', out: '10', trap: '不带前导 0；要前缀用 %#o' },
  { spec: '%x / %X', mean: '十六进制（无符号）', arg: 'unsigned int', demo: 'printf("%x %X", 255, 255)', out: 'ff FF', trap: '地址请用 %p，不要用 %x 打指针' },
  { spec: '%f', mean: '十进制小数', arg: 'double', demo: 'printf("%.2f", 3.14159)', out: '3.14', trap: 'float 会被提升成 double，仍用 %f；%lf 在 printf 里等价于 %f' },
  { spec: '%e / %E', mean: '科学计数法', arg: 'double', demo: 'printf("%e", 12345.6)', out: '1.234560e+04', trap: '默认 6 位小数' },
  { spec: '%g / %G', mean: '自动选 %e 或 %f，去掉尾部 0', arg: 'double', demo: 'printf("%g", 100.0)', out: '100', trap: '默认 6 位有效数字，大数会切成科学计数法' },
  { spec: '%c', mean: '单个字符', arg: 'int（字符值）', demo: 'printf("%c", 65)', out: 'A', trap: 'scanf("%c") 会把换行也当字符读走，常需 " %c"（前面加空格）' },
  { spec: '%s', mean: '字符串（到 \\0 为止）', arg: 'char *', demo: 'printf("%s", "hi")', out: 'hi', trap: '传 NULL 是未定义行为；%.3s 只打前 3 个字符' },
  { spec: '%p', mean: '指针地址', arg: 'void *', demo: 'printf("%p", (void *)&x)', out: '0x7ffd...', trap: '打印地址前先转 (void *)，值随运行而变，不能用来判分' },
  { spec: '%n', mean: '把已输出字符数写回 int*', arg: 'int *', demo: 'printf("ab%n", &c)', out: 'c = 2', trap: '危险且常被编译器禁用，本站题目一律不用' },
  { spec: '%%', mean: '输出一个百分号', arg: '无', demo: 'printf("100%%")', out: '100%', trap: '写成 "%" 会吃掉后面的字符当格式符' },
  { spec: '%5d', mean: '最小宽度 5，右对齐，左侧补空格', arg: 'int', demo: 'printf("[%5d]", 42)', out: '[   42]', trap: '宽度不足不会截断，只会撑开' },
  { spec: '%-5d', mean: '左对齐（- 标志）', arg: 'int', demo: 'printf("[%-5d]", 42)', out: '[42   ]', trap: '制表对齐常用' },
  { spec: '%05d', mean: '左侧补 0', arg: 'int', demo: 'printf("%05d", 42)', out: '00042', trap: '对浮点 %08.2f 补的是整数部分的 0' },
  { spec: '%+d', mean: '强制显示正负号', arg: 'int', demo: 'printf("%+d", 5)', out: '+5', trap: '负数本来就有 -' },
  { spec: '%7.2f', mean: '总宽 7，保留 2 位小数（四舍六入五成双）', arg: 'double', demo: 'printf("%7.2f", 3.14159)', out: '   3.14', trap: '.2 是精度，7 是宽度，含小数点' },
  { spec: '%hd / %ld / %lld', mean: '长度修饰符：short / long / long long', arg: 'short / long / long long', demo: 'printf("%lld", 1LL<<40)', out: '1099511627776', trap: '修饰符与实参类型不匹配 = 未定义行为，-Wall 会警告' },
]

const scanfRows: RefRow[] = [
  { spec: '%d', mean: '读十进制整数', arg: 'int *', demo: 'scanf("%d", &n)', out: '跳过前导空白', trap: '必须传地址 &n；漏了 & 是运行期崩溃的头号原因' },
  { spec: '%f', mean: '读浮点（scanf 里必须 %f，不认 %lf 之外的写法差异）', arg: 'float * / double *', demo: 'scanf("%lf", &d)', out: 'double 用 %lf', trap: 'printf 用 %f、scanf 用 %lf —— 两边不对称，容易记反' },
  { spec: '%c', mean: '读单个字符（不跳空白）', arg: 'char *', demo: 'scanf(" %c", &c)', out: '空格前缀可跳过换行', trap: '读混数字与字符时，前一个回车会被 %c 吃掉' },
  { spec: '%s', mean: '读一个单词（遇空白停）', arg: 'char *', demo: 'scanf("%19s", buf)', out: '自动补 \\0', trap: '不限宽度会溢出数组：必须写 %19s（数组 20 时留 1 位给 \\0）' },
  { spec: '%[abc] / %[^\\n]', mean: '扫描集：只读集合内字符 / 读到换行为止', arg: 'char *', demo: 'scanf("%[^\\n]", line)', out: '可读含空格的整行', trap: '比 gets 安全的前提是限宽：%99[^\\n]' },
  { spec: '%*d', mean: '读但丢弃（* 抑制赋值）', arg: '无', demo: 'scanf("%*d%d", &n)', out: '跳过第一个整数', trap: '跳过列时很有用，不计入返回值' },
  { spec: '返回值', mean: '成功赋值的项数，遇 EOF 或匹配失败返回 EOF', arg: 'int', demo: 'while (scanf("%d", &n) == 1)', out: '循环读入的标准写法', trap: '不检查返回值 → 输入非法时用未初始化变量，结果随机' },
]

/* ══════════════ 2. 运算符优先级（C99，15 级）══════════════ */

const precCols: RefColumn[] = [
  { key: 'lv', label: '优先级', noSearch: true },
  { key: 'ops', label: '运算符', mono: true },
  { key: 'name', label: '名称 / 说明' },
  { key: 'assoc', label: '结合性' },
  { key: 'demo', label: '示例', mono: true },
]

const precRows: RefRow[] = [
  { lv: '1（最高）', ops: '() [] . -> ++ -- (type)', name: '括号、下标、成员、后缀自增自减、复合字面量', assoc: '左→右', demo: 'a[i].x++' },
  { lv: '2', ops: '++ -- + - ! ~ * & sizeof (type)', name: '前缀自增自减、正负号、逻辑非、按位取反、间接访问、取地址、sizeof、强制转换', assoc: '右→左', demo: '-*p++ 等价于 -(*(p++))' },
  { lv: '3', ops: '* / %', name: '乘、除、取余', assoc: '左→右', demo: 'a/b*c 等价于 (a/b)*c' },
  { lv: '4', ops: '+ -', name: '加、减', assoc: '左→右', demo: 'a-b+c 等价于 (a-b)+c' },
  { lv: '5', ops: '<< >>', name: '左移、右移', assoc: '左→右', demo: '1<<2+1 等价于 1<<(2+1) —— 加法优先' },
  { lv: '6', ops: '< <= > >=', name: '关系运算', assoc: '左→右', demo: 'a<b==c 等价于 (a<b)==c' },
  { lv: '7', ops: '== !=', name: '相等运算', assoc: '左→右', demo: 'if (x&1==0) 是坑：等价于 x&(1==0)' },
  { lv: '8', ops: '&', name: '按位与', assoc: '左→右', demo: 'x&1 判断奇偶要写 if ((x&1)==1)' },
  { lv: '9', ops: '^', name: '按位异或', assoc: '左→右', demo: 'a^b' },
  { lv: '10', ops: '|', name: '按位或', assoc: '左→右', demo: 'flags|FLAG_A' },
  { lv: '11', ops: '&&', name: '逻辑与（短路）', assoc: '左→右', demo: 'p && *p 顺序不能反' },
  { lv: '12', ops: '||', name: '逻辑或（短路）', assoc: '左→右', demo: 'i<0 || a[i]>9' },
  { lv: '13', ops: '?:', name: '条件运算', assoc: '右→左', demo: 'a?b:c=1 等价于 a?b:(c=1)' },
  { lv: '14', ops: '= += -= *= /= %= &= ^= |= <<= >>=', name: '赋值与复合赋值', assoc: '右→左', demo: 'a=b=0' },
  { lv: '15（最低）', ops: ',', name: '逗号运算（求值后取右侧）', assoc: '左→右', demo: 'for (i=0,j=n; ...; i++,j--)' },
]

const precTips: RefTip[] = [
  { title: '只有 4 个右结合', body: '单目（第 2 级）、?:、赋值、逗号之外的全部左结合。记不住时就加括号 —— 加括号不扣分，猜错优先级要人命。' },
  { title: '& 比 == 低', body: 'if (x & 1 == 0) 实际是 if (x & (1 == 0))，永远为假。位运算参与比较必须自己加括号。' },
  { title: '= 与 ==', body: 'if (x = 1) 编译能过（-Wall 可能只给警告），条件永远为真。写「尤达条件」if (1 == x) 可以让编译器帮你挡住。' },
  { title: '移位比加法低', body: '1 << 2 + 1 是 1 << 3 = 8，不是 (1<<2)+1 = 5。' },
  { title: 'sizeof 是编译期常量', body: 'sizeof 不求值它的操作数（sizeof(i++) 之后 i 不变）；数组作函数实参会退化成指针，函数里 sizeof 得到的是指针大小。' },
]

/* ══════════════ 3. ASCII 码表（程序化生成，0–127）══════════════ */

/** 控制字符名（C99 转义写法能表达的优先给转义写法，学生一眼能对上手写代码） */
const CTRL: Record<number, [string, string]> = {
  0: ['NUL', '\\0 空字符（字符串结束标记）'], 1: ['SOH', '标题开始'], 2: ['STX', '正文开始'], 3: ['ETX', '正文结束'],
  4: ['EOT', '传输结束（Unix 下 Ctrl+D 即 EOF）'], 5: ['ENQ', '询问'], 6: ['ACK', '确认'], 7: ['BEL', '\\a 响铃'],
  8: ['BS', '\\b 退格'], 9: ['HT', '\\t 水平制表'], 10: ['LF', '\\n 换行'], 11: ['VT', '\\v 垂直制表'],
  12: ['FF', '\\f 换页'], 13: ['CR', '\\r 回车'], 14: ['SO', '移出'], 15: ['SI', '移入'],
  16: ['DLE', '数据链路转义'], 17: ['DC1', '设备控制1（XON）'], 18: ['DC2', '设备控制2'], 19: ['DC3', '设备控制3（XOFF）'],
  20: ['DC4', '设备控制4'], 21: ['NAK', '否定确认'], 22: ['SYN', '同步空闲'], 23: ['ETB', '传输块结束'],
  24: ['CAN', '取消'], 25: ['EM', '介质结束'], 26: ['SUB', '替换（Windows 下 Ctrl+Z 当 EOF）'], 27: ['ESC', '\\e 转义'],
  28: ['FS', '文件分隔符'], 29: ['GS', '组分隔符'], 30: ['RS', '记录分隔符'], 31: ['US', '单元分隔符'],
  127: ['DEL', '删除（退格键）'],
}

/** 不可打印字符在表格里用一个可见占位符，避免看起来像空单元格 */
function glyph(code: number): string {
  if (code === 32) return '␠ (空格)'
  if (code === 127) return '␡'
  if (code < 32) return '␀'
  return String.fromCharCode(code)
}

const hex = (n: number) => n.toString(16).toUpperCase().padStart(2, '0')
const oct = (n: number) => n.toString(8).padStart(3, '0')

function asciiRows(): RefRow[] {
  const out: RefRow[] = []
  for (let code = 0; code < 128; code += 1) {
    const ctrl = CTRL[code]
    const printable = code >= 32 && code <= 126
    out.push({
      dec: String(code),
      hex: '0x' + hex(code),
      oct: '\\' + oct(code),
      ch: glyph(code),
      name: ctrl ? `${ctrl[0]} ${ctrl[1]}` : printable ? `可打印字符 '${String.fromCharCode(code)}'` : '—',
      lit: printable && code !== 39 && code !== 92 ? `'${String.fromCharCode(code)}'` : printable ? `'\\${String.fromCharCode(code)}'` : `'\\${oct(code)}'`,
    })
  }
  return out
}

const asciiCols: RefColumn[] = [
  { key: 'dec', label: '十进制', noSearch: true },
  { key: 'hex', label: '十六进制', mono: true, noSearch: true },
  { key: 'oct', label: '八进制转义', mono: true, noSearch: true },
  { key: 'ch', label: '字符', mono: true, noSearch: true },
  { key: 'lit', label: 'C 字面量', mono: true },
  { key: 'name', label: '名称 / 说明' },
]

const asciiTips: RefTip[] = [
  { title: '四个必背数字', body: "'0' = 48、'A' = 65、'a' = 97、' ' = 32。大小写相差 32（大写 + 32 = 小写）；数字字符 - '0' 就是它的数值。" },
  { title: '字符就是整数', body: "C 里 'A' 的类型是 int（值 65），所以 putchar('A' + 1) 打出 B；反过来 printf(\"%d\", 'A') 打出 65。" },
  { title: '换行在不同系统不一样', body: "Windows 文本文件是 \\r\\n，Unix 是 \\n。以 \"r\" 模式打开文本文件时，C 运行库会把 \\r\\n 翻译成一个 \\n；以 \"rb\" 打开则原样读，字节数会对不上。" },
  { title: 'EOF 不是字符', body: 'EOF 是 stdio.h 里的 int 常量（通常 -1），不在 ASCII 表内 —— 这正是 getchar() 必须返回 int 而不是 char 的原因。' },
]

/* ══════════════ 4. 转义字符与 sizeof / 极值 ══════════════ */

const escRows: RefRow[] = [
  { lit: '\\n', mean: '换行 LF', val: '10', demo: 'printf("a\\nb")' },
  { lit: '\\t', mean: '水平制表 TAB', val: '9', demo: 'printf("%d\\t%d", a, b)' },
  { lit: '\\r', mean: '回车 CR（回到行首，不换行）', val: '13', demo: '进度条刷新常用 printf("\\r%d%%", p)' },
  { lit: '\\0', mean: '空字符 NUL，字符串结束标记', val: '0', demo: "s[i] = '\\0' 手动截断" },
  { lit: '\\\\', mean: '一个反斜杠', val: '92', demo: 'printf("C:\\\\tmp")' },
  { lit: "\\'", mean: '单引号（字符常量里必须转义）', val: '39', demo: "char c = '\\''" },
  { lit: '\\"', mean: '双引号（字符串里必须转义）', val: '34', demo: 'printf("他说\\"好\\"")' },
  { lit: '\\a', mean: '响铃 BEL', val: '7', demo: '在线判分环境听不见，别用它做输出' },
  { lit: '\\b', mean: '退格 BS', val: '8', demo: '终端里会吃掉前一个字符' },
  { lit: '\\f', mean: '换页 FF', val: '12', demo: '老式打印机遗留' },
  { lit: '\\v', mean: '垂直制表 VT', val: '11', demo: '很少用' },
  { lit: '\\ddd', mean: '1–3 位八进制表示的字符', val: '按值', demo: "'\\101' 就是 'A'" },
  { lit: '\\xhh', mean: '十六进制表示的字符', val: '按值', demo: "'\\x41' 就是 'A'；注意 \\x 会尽量多吃十六进制位" },
]

const sizeRows: RefRow[] = [
  { t: 'char / signed char / unsigned char', size: '1', note: '标准规定就是 1 字节；CHAR_BIT 至少 8（本站所有实测环境都是 8）' },
  { t: 'short', size: '2', note: '至少 16 位，范围 -32768..32767' },
  { t: 'int', size: '4', note: '本站判分环境 x86-64 上是 4 字节，范围 -2147483648..2147483647' },
  { t: 'long', size: '4（Windows）/ 8（Linux x86-64）', note: '跨平台最容易踩的差异；Godbolt 是 Linux，sizeof(long)=8' },
  { t: 'long long', size: '8', note: 'C99 起保证至少 64 位' },
  { t: 'float', size: '4', note: '约 6–7 位十进制有效数字，别用它做精确比较' },
  { t: 'double', size: '8', note: '约 15–16 位有效数字；printf 的可变参数里 float 会自动提升成 double' },
  { t: '指针（任何类型）', size: '8（x86-64）', note: 'sizeof(int*) == sizeof(char*)；数组名在表达式里退化成指针，sizeof 结果不同' },
]

const limitRows: RefRow[] = [
  { m: 'CHAR_BIT', v: '8', h: 'limits.h', use: '一个字节多少位' },
  { m: 'INT_MAX / INT_MIN', v: '2147483647 / -2147483648', h: 'limits.h', use: 'int 极值；INT_MAX+1 溢出是未定义行为' },
  { m: 'UINT_MAX', v: '4294967295', h: 'limits.h', use: 'unsigned int 最大值；无符号回绕是有定义的（模 2^32）' },
  { m: 'LONG_MAX', v: '9223372036854775807（Linux x86-64）', h: 'limits.h', use: 'long 极值，平台相关' },
  { m: 'LLONG_MAX', v: '9223372036854775807', h: 'limits.h', use: 'long long 极值；字面量写 9223372036854775807LL' },
  { m: 'SIZE_MAX', v: '18446744073709551615', h: 'stdint.h', use: 'size_t 最大值' },
  { m: 'FLT_EPSILON / DBL_EPSILON', v: '1.19e-7 / 2.22e-16', h: 'float.h', use: '浮点比较用 fabs(a-b) < 1e-6，不要用 ==' },
  { m: 'EOF', v: '-1（实现定义，必为负）', h: 'stdio.h', use: 'getchar/fgetc 到文件尾或出错时返回它' },
]

/* ══════════════ 5. 关键字（C89 32 个 + C99 新增 5 个 = 37）══════════════ */

const kwCols: RefColumn[] = [
  { key: 'kw', label: '关键字', mono: true },
  { key: 'grp', label: '分类' },
  { key: 'std', label: '标准' },
  { key: 'use', label: '用法与坑' },
]

function kw(rows: [string, string, string, string][]): RefRow[] {
  return rows.map(([k, grp, std, use]) => ({ kw: k, grp, std, use }))
}

const kwRows: RefRow[] = kw([
  ['char', '数据类型', 'C89', '字符型，恰好 1 字节；本质是小整数，可参与算术'],
  ['int', '数据类型', 'C89', '整型，本站环境 4 字节'],
  ['short', '数据类型', 'C89', '短整型，至少 16 位；只写 short 等价于 short int'],
  ['long', '数据类型', 'C89', '长整型，平台相关（Windows 4 / Linux x86-64 8）'],
  ['float', '数据类型', 'C89', '单精度浮点，字面量要加 f 后缀：3.14f'],
  ['double', '数据类型', 'C89', '双精度浮点；不带后缀的小数字面量默认就是 double'],
  ['signed', '类型修饰', 'C89', '有符号（整型默认就是 signed，可省略）'],
  ['unsigned', '类型修饰', 'C89', '无符号；回绕有定义，但与有符号比较会隐式转换，是经典坑'],
  ['void', '数据类型', 'C89', '空类型：无返回值 / 无参数 / 通用指针 void*'],
  ['struct', '构造类型', 'C89', '结构体； typedef struct Node {...} Node; 是本站统一写法'],
  ['union', '构造类型', 'C89', '共用体：所有成员共享同一块内存，大小等于最大成员（含对齐）'],
  ['enum', '构造类型', 'C89', '枚举：本质是 int 常量集合，可读性优于 #define'],
  ['sizeof', '运算符', 'C89', '求字节数，编译期常量；不求值操作数：sizeof(i++) 后 i 不变'],
  ['typedef', '声明', 'C89', '起别名，不创建新类型；函数指针别名尤其需要它'],
  ['const', '类型限定', 'C89', '只读；const int *p 指内容不可改，int *const p 指指针不可改'],
  ['volatile', '类型限定', 'C89', '禁止优化，每次都从内存读（硬件寄存器、信号处理用）'],
  ['static', '存储类别', 'C89', '局部：生命周期延长到程序结束、只初始化一次；全局/函数：限制链接属性为本文件'],
  ['extern', '存储类别', 'C89', '声明「定义在别处」的全局变量，不分配存储'],
  ['register', '存储类别', 'C89', '建议放寄存器；C99 起编译器基本忽略，且不能取地址'],
  ['auto', '存储类别', 'C89', '局部变量默认存储类别，几乎从不显式写（C++ 的 auto 推导是另一回事，C 里没有）'],
  ['if', '流程控制', 'C89', '条件判断；if (x = 1) 是赋值不是比较'],
  ['else', '流程控制', 'C89', 'else 与最近一个未配对的 if 结合（悬垂 else）'],
  ['switch', '流程控制', 'C89', '多分支；case 只能是整型常量表达式，忘写 break 会贯穿'],
  ['case', '流程控制', 'C89', 'switch 的分支标号，必须是常量'],
  ['default', '流程控制', 'C89', 'switch 的兜底分支，建议一律写上'],
  ['for', '流程控制', 'C89', '计数循环；C99 允许在初始化里声明变量：for (int i = 0; ...)'],
  ['while', '流程控制', 'C89', '当型循环，先判后做'],
  ['do', '流程控制', 'C89', '直到型循环，至少执行一次；do {...} while (x); 的分号不能少'],
  ['break', '流程控制', 'C89', '跳出最近的 switch 或循环（只跳一层）'],
  ['continue', '流程控制', 'C89', '跳过本次循环剩余语句，进入下一次判定'],
  ['goto', '流程控制', 'C89', '无条件跳转；本站只在「多层循环统一错误清理」这种场景认可它'],
  ['return', '流程控制', 'C89', '返回值并结束函数；main 里省略 return 0 由 C99 自动补'],
  ['inline', '函数限定', 'C99', '建议内联展开；extern inline / static inline 的链接规则容易踩坑'],
  ['restrict', '指针限定', 'C99', '承诺该指针是访问这块内存的唯一途径，允许更强优化（memcpy 原型里就有）'],
  ['_Bool', '数据类型', 'C99', '真正的布尔类型，只有 0/1；#include <stdbool.h> 后可写 bool / true / false'],
  ['_Complex', '数据类型', 'C99', '复数类型；配合 <complex.h>，本站题目不涉及'],
  ['_Imaginary', '数据类型', 'C99', '虚数类型；实现可选，本站题目不涉及'],
])

/* ══════════════ 6. 常用库函数（按头文件分组）══════════════ */

const fnCols: RefColumn[] = [
  { key: 'fn', label: '函数', mono: true },
  { key: 'proto', label: '原型（简化）', mono: true },
  { key: 'use', label: '作用' },
  { key: 'trap', label: '坑 / 备注' },
]

function fn(rows: [string, string, string, string][]): RefRow[] {
  return rows.map(([f2, proto, use, trap]) => ({ fn: f2, proto, use, trap }))
}

const stdioRows: RefRow[] = fn([
  ['printf', 'int printf(const char *fmt, ...)', '格式化输出到 stdout，返回输出字符数', '返回负值表示出错；格式符与实参类型不匹配是未定义行为'],
  ['scanf', 'int scanf(const char *fmt, ...)', '从 stdin 格式化读入，返回成功赋值项数', '必须传地址；不检查返回值就会拿未初始化变量去算'],
  ['sprintf / snprintf', 'int snprintf(char *s, size_t n, const char *fmt, ...)', '格式化写入字符串', '一律用 snprintf 并传 sizeof(buf)，sprintf 会溢出'],
  ['sscanf', 'int sscanf(const char *s, const char *fmt, ...)', '从字符串里解析', '解析日期/坐标很方便，返回成功项数'],
  ['putchar / getchar', 'int putchar(int c) / int getchar(void)', '单字符输出 / 输入', '返回类型是 int 不是 char —— 要能装下 EOF(-1)'],
  ['puts / gets', 'int puts(const char *s) / gets 已废除', 'puts 输出字符串并自动换行', 'gets 无法限宽、必然溢出，C11 已从标准删除；本站全面禁用，用 fgets(s, sizeof s, stdin)'],
  ['fgets', 'char *fgets(char *s, int n, FILE *fp)', '读一行（最多 n-1 个字符，自动补 \\0）', '会把行尾 \\n 一起读进来，通常需要手动去掉'],
  ['fputs / fprintf / fscanf', 'int fprintf(FILE *fp, const char *fmt, ...)', '带流版本的 puts/printf/scanf', 'fprintf(stderr, ...) 打错误信息，不会混进被比对的 stdout'],
  ['fopen / fclose', 'FILE *fopen(const char *path, const char *mode)', '打开 / 关闭文件', '打开失败返回 NULL 必须检查；模式 "r" "w" "a" "rb" "wb" "r+"'],
  ['fgetc / fputc / ungetc', 'int fgetc(FILE *fp)', '按字符读写流', 'fgetc 到文件尾返回 EOF，不是 0'],
  ['fread / fwrite', 'size_t fread(void *ptr, size_t size, size_t n, FILE *fp)', '二进制块读写', '返回成功读到的**元素个数**；读结构体数组时注意对齐填充'],
  ['fseek / ftell / rewind', 'int fseek(FILE *fp, long off, int whence)', '移动文件位置指针', 'whence: SEEK_SET/SEEK_CUR/SEEK_END；文本模式下的 fseek 行为受限'],
  ['feof / ferror / clearerr', 'int feof(FILE *fp)', '判断是否已到文件尾 / 出错', 'while (!feof(fp)) 是错的写法：feof 只在读失败后才为真，会多循环一次'],
  ['remove / rename', 'int remove(const char *path)', '删除 / 重命名文件', '成功返回 0'],
  ['setvbuf / fflush', 'int fflush(FILE *fp)', '控制缓冲 / 强制刷新', 'fflush(NULL) 刷新所有输出流；对输入流 fflush 是未定义行为'],
])

const stringRows: RefRow[] = fn([
  ['strlen', 'size_t strlen(const char *s)', '求字符串长度（不含 \\0）', '返回 size_t（无符号）：strlen(a) - strlen(b) 可能变成巨大的正数'],
  ['strcpy / strncpy', 'char *strcpy(char *dst, const char *src)', '复制字符串', '目标数组必须够大；strncpy 在截断时**不补 \\0**，用后要手动 s[n-1] = 0'],
  ['strcat / strncat', 'char *strcat(char *dst, const char *src)', '拼接字符串', '拼接前 dst 必须已是以 \\0 结尾的串；容量要算上原有长度'],
  ['strcmp / strncmp', 'int strcmp(const char *a, const char *b)', '比较字符串，返回 <0 / 0 / >0', '判等要写 strcmp(a,b)==0，不能写 a==b（那是比地址）'],
  ['strchr / strrchr', 'char *strchr(const char *s, int c)', '找字符首次 / 末次出现位置', '找不到返回 NULL；找到 \\0 本身会返回指向结尾的指针'],
  ['strstr', 'char *strstr(const char *hay, const char *needle)', '找子串首次出现位置', '找不到返回 NULL；needle 为空串时返回 hay'],
  ['strtok', 'char *strtok(char *s, const char *delim)', '按分隔符切分字符串', '会**修改原串**（写入 \\0），且非可重入；首次传串、后续传 NULL'],
  ['memcpy / memmove', 'void *memcpy(void *dst, const void *src, size_t n)', '按字节复制 n 字节', '区间重叠时必须用 memmove，memcpy 是未定义行为'],
  ['memset / memcmp', 'void *memset(void *s, int c, size_t n)', '填充 / 比较内存块', 'memset(p, 0, sizeof *p) 清零结构体；memcmp 比较含填充的结构体不可靠'],
  ['strerror', 'char *strerror(int errnum)', '把 errno 翻成可读文本', '配合 perror 打印失败原因'],
  ['strdup', 'char *strdup(const char *s)', '复制一份新串（malloc 分配）', 'POSIX 而非 C99 标准，本站判分环境可用但要自己 free'],
])

const stdlibRows: RefRow[] = fn([
  ['malloc / free', 'void *malloc(size_t n) / void free(void *p)', '堆上分配 / 释放', 'malloc 可能返回 NULL 必须检查；free 后要把指针置 NULL，否则是悬空指针'],
  ['calloc / realloc', 'void *calloc(size_t n, size_t size)', '分配并清零 / 调整大小', 'realloc 失败返回 NULL 且**原块仍有效**，别直接覆盖原指针'],
  ['exit / _Exit / atexit', 'void exit(int status)', '结束程序', 'exit 会刷新缓冲并调用 atexit 回调；main 里 return 0 与 exit(0) 等价'],
  ['abort', 'void abort(void)', '异常终止（不刷新缓冲）', 'assert 失败就是调它'],
  ['atoi / atol / atof', 'int atoi(const char *s)', '字符串转数字', '无法区分「转换结果是 0」和「转换失败」；要检查就用 strtol'],
  ['strtol / strtod', 'long strtol(const char *s, char **end, int base)', '带错误检测的字符串转数字', '检查 errno 与 end 指针；base 传 0 可自动识别 0x / 0 前缀'],
  ['rand / srand', 'int rand(void) / void srand(unsigned seed)', '伪随机数（0..RAND_MAX）', '同一秒内 srand(time(NULL)) 结果相同；取范围用 rand() % n（分布略有偏差）'],
  ['abs / labs / llabs', 'int abs(int n)', '整数绝对值', 'abs(INT_MIN) 仍是负数（溢出）；浮点要用 math.h 的 fabs'],
  ['qsort', 'void qsort(void *base, size_t n, size_t size, int (*cmp)(const void*, const void*))', '通用排序', '比较函数必须返回负/零/正，且**不能相减后返回**（可能溢出），要分支判断'],
  ['bsearch', 'void *bsearch(const void *key, const void *base, ...)', '二分查找', '数组必须已按同一比较函数排好序'],
  ['getenv / system', 'char *getenv(const char *name)', '读环境变量 / 调用系统命令', 'system("pause") 属非标准用法，本站禁用；system 返回值平台相关'],
  ['div / lldiv', 'div_t div(int num, int den)', '一次得到商与余数', '结构体成员 quot / rem'],
])

const mathRows: RefRow[] = fn([
  ['fabs', 'double fabs(double x)', '浮点绝对值', '整数的 abs 在 stdlib.h，混用会得到错误结果'],
  ['sqrt / cbrt / pow', 'double pow(double b, double e)', '平方根 / 立方根 / 幂', 'pow(x, 2) 比 x*x 慢得多；负数开方返回 NaN'],
  ['ceil / floor / round / trunc', 'double ceil(double x)', '向上 / 向下 / 四舍五入 / 截断取整', '返回的是 double，要 (int) 转换；round(-2.5) = -3'],
  ['fmod', 'double fmod(double x, double y)', '浮点取余', '浮点没有 % 运算符，写 x % y 编译不过'],
  ['exp / log / log10 / log2', 'double log(double x)', 'e 的幂 / 自然对数 / 常用对数', 'log(0) 与 log(负数) 是定义域错误'],
  ['sin / cos / tan / asin ...', 'double sin(double x)', '三角函数（弧度制）', '参数是弧度：角度要先 * PI / 180'],
  ['isnan / isinf / isfinite', 'int isnan(double x)（C99 是宏）', '判断 NaN / 无穷', 'NaN 与任何值比较都为假，包括它自己：x != x 是判 NaN 的土办法'],
  ['链接提示', '—', '—', 'GCC 下用 math.h 通常要加 -lm；本站判分参数固定 -std=c99 -Wall -Wextra，Godbolt 会自动链接 libm'],
])

const ctypeRows: RefRow[] = fn([
  ['isdigit / isalpha / isalnum', 'int isdigit(int c)', '数字 / 字母 / 字母数字', '实参必须是 unsigned char 值或 EOF；直接传 char（可能有符号）是未定义行为'],
  ['isspace / isupper / islower', 'int isspace(int c)', '空白 / 大写 / 小写', 'isspace 认 空格 \\t \\n \\r \\v \\f 六种'],
  ['toupper / tolower', 'int toupper(int c)', '大小写转换（返回 int）', '不满足条件时原样返回；不会修改原字符'],
  ['ispunct / isprint / iscntrl / isxdigit', 'int isprint(int c)', '标点 / 可打印 / 控制 / 十六进制位', 'isprint 包含空格，isgraph 不含'],
])

const timeRows: RefRow[] = fn([
  ['time', 'time_t time(time_t *t)', '取日历时间（秒）', '传 NULL 只用返回值即可'],
  ['clock', 'clock_t clock(void)', '取进程 CPU 时间（CLOCKS_PER_SEC 为单位）', '测算法耗时的正确姿势，比 time 精度高一到两个数量级'],
  ['difftime', 'double difftime(time_t end, time_t begin)', '两个时间之差（秒）', '顺序反了会得到负数'],
  ['localtime / strftime', 'struct tm *localtime(const time_t *t)', '转本地时间 / 格式化', 'localtime 返回静态缓冲区，非可重入；用 strftime 输出可读时间'],
])

const miscRows: RefRow[] = fn([
  ['assert', 'void assert(int expression)（宏）', '断言失败就打印并 abort', '#define NDEBUG 后全部失效，不能用它代替真正的错误处理'],
  ['stdarg: va_start/va_arg/va_end', 'void va_start(va_list ap, last)', '写可变参数函数', 'va_start 第二个实参必须是最后一个具名参数；结束要 va_end'],
  ['errno / perror', 'extern int errno', '最近一次库函数错误码', '调用前先 errno = 0，否则读到的是上一次的残留'],
  ['EXIT_SUCCESS / EXIT_FAILURE', '宏（stdlib.h）', 'exit 的标准返回码', '比裸写 0 / 1 更可移植'],
  ['NULL / size_t / offsetof', '宏与类型', '空指针 / 无符号长度类型 / 成员偏移', 'NULL 是 (void*)0 或 0；sizeof 的结果类型就是 size_t'],
])

/* ══════════════ 组装：6 个分区 ══════════════ */

export const REF_SECTIONS: RefSection[] = [
  {
    id: 'io',
    emoji: '📤',
    title: 'printf / scanf 格式符',
    intro: '格式符与实参类型不匹配是未定义行为，编译器不一定报错。这一页按「写什么、给什么、出什么、坑在哪」四栏对齐。',
    tables: [
      { id: 'printf', title: 'printf 转换说明', caption: 'printf 格式符速查表（含义、实参类型、示例、输出、坑）', columns: printfCols, rows: printfRows },
      { id: 'scanf', title: 'scanf 转换说明', caption: 'scanf 格式符速查表（含义、实参类型、示例、行为、坑）', columns: printfCols, rows: scanfRows },
    ],
    tips: [
      { title: '宽度与精度', body: '%[标志][宽度][.精度][长度修饰]转换符。宽度是「最少占几列」（不足补空格或 0，超了不截断）；精度对 %f 是小数位数，对 %s 是「最多打几个字符」，对 %d 是「最少几位数字」。' },
      { title: 'scanf 必须传地址', body: 'scanf("%d", n) 少写 & 是最常见的运行期崩溃。数组名本身就是地址，所以 scanf("%19s", buf) 不用 &。' },
      { title: '读入循环的标准写法', body: 'while (scanf("%d", &n) == 1) { ... } —— 既处理空格分隔的一串数，也能正确结束于 EOF。不要写 while (!feof(stdin))。' },
      { title: '输出比对与换行', body: '本站判分比对的是 stdout 文本。少一个 \\n、多一个空格都会判错；调试时可以用 fprintf(stderr, ...) 打日志，它不进 stdout。' },
    ],
  },
  {
    id: 'prec',
    emoji: '🧮',
    title: '运算符优先级',
    intro: 'C99 共 15 个优先级层次。表里第 1 级最高、第 15 级最低；同一级内看「结合性」。',
    tables: [
      { id: 'prec', title: '15 级优先级总表', caption: 'C 语言运算符优先级与结合性速查表（15 级）', columns: precCols, rows: precRows },
    ],
    tips: precTips,
  },
  {
    id: 'ascii',
    emoji: '🔤',
    title: 'ASCII 码表与转义字符',
    intro: '完整 0–127（标准 ASCII）。表由 charCode 程序化生成，不是手抄的 —— 十进制 / 十六进制 / 八进制转义三种写法一次给全。',
    tables: [
      { id: 'ascii', title: 'ASCII 0–127', caption: 'ASCII 码表（十进制、十六进制、八进制转义、字符、C 字面量、名称）', note: '不可打印字符用 ␀ / ␠ / ␡ 占位显示，避免看起来像空单元格。', columns: asciiCols, rows: asciiRows() },
      { id: 'esc', title: '转义字符', caption: 'C 语言转义字符速查表（写法、含义、对应 ASCII 值、示例）', columns: [
        { key: 'lit', label: '写法', mono: true },
        { key: 'mean', label: '含义' },
        { key: 'val', label: 'ASCII 值', mono: true, noSearch: true },
        { key: 'demo', label: '示例', mono: true },
      ], rows: escRows },
    ],
    tips: asciiTips,
  },
  {
    id: 'kw',
    emoji: '🔑',
    title: '关键字速查（37 个）',
    intro: 'C89 的 32 个关键字 + C99 新增的 5 个。关键字不能当标识符；本站题目一律用标准 C99 口径。',
    tables: [
      { id: 'kw', title: 'C89 + C99 关键字', caption: 'C 语言关键字速查表（关键字、分类、引入标准、用法与坑）', columns: kwCols, rows: kwRows },
    ],
    tips: [
      { title: '大小写敏感', body: 'C 的关键字全小写。Int、MAIN、NULL 写成小写都是标识符错误或未定义符号（NULL 是宏，必须大写）。' },
      { title: 'C99 才有的东西', body: 'inline、restrict、_Bool/_Complex/_Imaginary 是 C99 新增；for 循环里直接声明变量（for (int i = 0; ...)）也是 C99 起才允许 —— 本站固定 -std=c99，可以放心用。' },
      { title: 'C++ 关键字不是 C 关键字', body: 'new / delete / class / template / namespace / bool（小写）/ true / false 都不属于 C99（bool、true、false 需 #include <stdbool.h>）。本站禁用 C++ 语法。' },
    ],
  },
  {
    id: 'size',
    emoji: '📏',
    title: '类型大小、极值与浮点比较',
    intro: '「sizeof 到底是多少」没有唯一答案：标准只规定下限，实际取决于平台。下表给出本站判分环境（x86-64 Linux / GCC 13.2）的实测值。',
    tables: [
      { id: 'size', title: 'sizeof 速查（x86-64）', caption: '常见类型在本站判分环境下的 sizeof 与说明', columns: [
        { key: 't', label: '类型', mono: true },
        { key: 'size', label: 'sizeof（字节）', mono: true },
        { key: 'note', label: '说明' },
      ], rows: sizeRows },
      { id: 'limits', title: '极值与常量', caption: '常用极值与常量速查表（宏、值、所在头文件、用途）', columns: [
        { key: 'm', label: '宏 / 常量', mono: true },
        { key: 'v', label: '本站环境取值', mono: true },
        { key: 'h', label: '头文件', mono: true },
        { key: 'use', label: '用途与坑' },
      ], rows: limitRows },
    ],
    tips: [
      { title: '数组与指针的 sizeof 不同', body: 'int a[10]; 在定义它的作用域里 sizeof(a) = 40；一旦作为实参传进函数，a 退化成 int*，sizeof(a) = 8。要长度就把长度一起传进去。' },
      { title: '整数溢出与无符号回绕', body: '有符号溢出是未定义行为（编译器可以假设它不发生，从而优化掉你的判断）；无符号回绕是有定义的模运算。INT_MAX + 1 别写。' },
      { title: '浮点不要 ==', body: '0.1 + 0.2 != 0.3。判等一律用 fabs(a - b) < 1e-6；本站的判分对浮点输出也是按文本精确比对，所以请按题目要求的精度用 %.2f 之类打印。' },
      { title: '结构体有填充', body: 'struct { char c; int i; } 的 sizeof 是 8 不是 5（对齐填充）。用 memcmp 比较两个结构体因此不可靠，要逐成员比。' },
    ],
  },
  {
    id: 'lib',
    emoji: '📚',
    title: '常用库函数（按头文件）',
    intro: '只收「课程与真题里真的会用到的」，每个都带一条坑。原型是简化版（省略了部分限定符），以头文件为准。',
    tables: [
      { id: 'stdio', title: '<stdio.h> 输入输出与文件', caption: 'stdio.h 常用函数速查表（函数、简化原型、作用、坑）', columns: fnCols, rows: stdioRows },
      { id: 'string', title: '<string.h> 字符串与内存', caption: 'string.h 常用函数速查表（函数、简化原型、作用、坑）', columns: fnCols, rows: stringRows },
      { id: 'stdlib', title: '<stdlib.h> 内存、转换、随机、排序', caption: 'stdlib.h 常用函数速查表（函数、简化原型、作用、坑）', columns: fnCols, rows: stdlibRows },
      { id: 'math', title: '<math.h> 数学', caption: 'math.h 常用函数速查表（函数、简化原型、作用、坑）', columns: fnCols, rows: mathRows },
      { id: 'ctype', title: '<ctype.h> 字符分类', caption: 'ctype.h 常用函数速查表（函数、简化原型、作用、坑）', columns: fnCols, rows: ctypeRows },
      { id: 'time', title: '<time.h> 时间与计时', caption: 'time.h 常用函数速查表（函数、简化原型、作用、坑）', columns: fnCols, rows: timeRows },
      { id: 'misc', title: '其它常用宏与工具', caption: 'assert、stdarg、errno 等常用宏与工具速查表', columns: fnCols, rows: miscRows },
    ],
    tips: [
      { title: '该 include 什么', body: '用了 printf 就 #include <stdio.h>，用了 malloc 就 #include <stdlib.h>，用了 strlen 就 #include <string.h>。漏了 include 在 C99 下是「隐式声明」警告，函数返回值会被当成 int，指针就被截断了。' },
      { title: '禁用清单（本站硬性约束）', body: 'gets、conio.h、getch、system("pause") 一律不许出现在题目代码里：它们要么已被标准废除，要么根本不是标准 C。' },
      { title: '想验证就去游乐场', body: '每条都能立刻试：打开「🧪 游乐场」粘一段代码，Ctrl+Enter 真机编译运行（GCC 13.2 / Clang 18.1 可切换），诊断直接标在编辑器行上。' },
    ],
  },
]

/** 全部行数（页面上如实报「共 N 条」，也用来做搜索结果计数） */
export const REF_ROW_COUNT: number = REF_SECTIONS.reduce((a, s) => a + s.tables.reduce((b, t) => b + t.rows.length, 0), 0)

/** 参与搜索的文本：只取 noSearch 未标记的列，避免「搜 0x41 命中整张 ASCII 表」这种噪声 */
export function rowMatches(row: RefRow, columns: RefColumn[], q: string): boolean {
  const needle = q.toLowerCase()
  for (const c of columns) {
    if (c.noSearch) continue
    const v = row[c.key]
    if (v && v.toLowerCase().includes(needle)) return true
  }
  return false
}
