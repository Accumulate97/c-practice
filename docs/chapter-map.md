# 章节编号对照表（唯一真源）

> 本文件是全站**章节编号的唯一真源**。题目 id、`chapter` 字段、知识卡片编号、数据分片文件名，
> 凡涉及「第几章」的地方都以本表为准。`scripts/verify-data.ts` 会解析本文件末尾的机器可读块，
> 强制校验**三向一致**：id 前缀（`c-chNN-` / `ds-chNN-`）↔ `chapter` 字符串 ↔ 分片文件名。

---

## 一、骨架来源

| 类别 | 前缀 | 教材 | 章数 |
|---|---|---|---|
| C 语言 | `c-` | 谭浩强《C程序设计》（第五版）＝ `01_知识大纲_C语言.md` **第一部分** | 10 |
| 数据结构 | `ds-` | 严蔚敏《数据结构（C语言版）第2版》＝ `02_知识大纲_数据结构.md` **第一部分** | 8 |

**选骨架的理由**：`04_题型规范与样例.md` 的样例 `c-ch05-pg-001`（第5章 循环结构）与 `c-ch05-co-001`
这两个章号只在谭浩强体系下成立（C Primer Plus 第5章是运算符、第6章才是循环）；`02` 的第一部分本身
声明为「主骨架」。两本教材的**第二部分**（C Primer Plus 17 章、朱战立、大话数据结构）只作为考点与
代码风格来源，**不参与编号**。

## 二、C 语言（`c-ch01` ~ `c-ch10`）

| id 前缀 | `chapter` 权威字符串 | 教材章名 | 主要考点 | 分片文件名 |
|---|---|---|---|---|
| `c-ch01` | `第1章 程序设计和C语言` | 程序设计和C语言 | C 程序结构、预处理、编译链接四步、标识符与作用域初识 | `c-ch01.json` |
| `c-ch02` | `第2章 算法——程序的灵魂` | 算法——程序的灵魂 | 算法五个特性、五种表示法、复杂度直觉 | `c-ch02.json` |
| `c-ch03` | `第3章 最简单的C程序设计——顺序程序设计` | 最简单的C程序设计——顺序程序设计 | 格式字符、基本数据类型、运算符与表达式、隐式转换 | `c-ch03.json` |
| `c-ch04` | `第4章 选择结构程序设计` | 选择结构程序设计 | 关系/逻辑表达式、if 三种形式、else 配对规则、switch 与 break | `c-ch04.json` |
| `c-ch05` | `第5章 循环结构程序设计` | 循环结构程序设计 | while / do…while / for、循环嵌套、break 与 continue | `c-ch05.json` |
| `c-ch06` | `第6章 利用数组处理批量数据` | 利用数组处理批量数据 | 一维数组、二维数组、字符数组与字符串、查找与统计等常用算法 | `c-ch06.json` |
| `c-ch07` | `第7章 用函数实现模块化程序设计` | 用函数实现模块化程序设计 | 函数定义与调用、值传递、递归、数组作参数、作用域与存储类别 | `c-ch07.json` |
| `c-ch08` | `第8章 善于利用指针` | 善于利用指针 ★重点章 | 指针与变量/数组/字符串/函数、二级指针、malloc 与 free | `c-ch08.json` |
| `c-ch09` | `第9章 用户自己建立数据类型` | 用户自己建立数据类型 | 结构体、结构数组、链表、共用体、枚举、typedef | `c-ch09.json` |
| `c-ch10` | `第10章 对文件的输入输出` | 对文件的输入输出 | 文件指针、fopen/fclose、fgetc/fgets/fprintf、读写方式 | `c-ch10.json` |

- `chapter` 字段**不含** `★重点章` 之类的标注，也不允许空格差异：必须与上表第二列**逐字相同**。
- `section` 填「教材节号 + 节名」，数字前缀必须落在本章内（第5章只能是 `5`、`5.3`、`5.7.2` 这类开头）。

## 三、数据结构（`ds-ch01` ~ `ds-ch08`）

| id 前缀 | `chapter` 权威字符串 | 教材章名 | 主要考点 | 分片文件名 |
|---|---|---|---|---|
| `ds-ch01` | `第1章 绪论` | 绪论 | 数据结构三要素、逻辑结构与存储结构、ADT、算法复杂度分析 | `ds-ch01.json` |
| `ds-ch02` | `第2章 线性表` | 线性表 | 顺序表增删改查、单链表/循环链表/双向链表、有序表合并、时空权衡 | `ds-ch02.json` |
| `ds-ch03` | `第3章 栈和队列` | 栈和队列 | 进出栈序列、循环队列判满、链栈链队列、表达式求值、递归 | `ds-ch03.json` |
| `ds-ch04` | `第4章 串、数组和广义表` | 串、数组和广义表 | KMP 与 next 数组、矩阵压缩存储、稀疏矩阵、广义表 | `ds-ch04.json` |
| `ds-ch05` | `第5章 树和二叉树` | 树和二叉树 ★重点章 | 性质与术语、四种遍历、由遍历序列复原、哈夫曼树、并查集 | `ds-ch05.json` |
| `ds-ch06` | `第6章 图` | 图 ★重点章 | 图的存储结构、BFS/DFS、最小生成树、最短路、拓扑与关键路径 | `ds-ch06.json` |
| `ds-ch07` | `第7章 查找` | 查找 ★重点章 | ASL、二分查找、分块查找、二叉排序树与平衡树、B 树、散列冲突 | `ds-ch07.json` |
| `ds-ch08` | `第8章 排序` | 排序 ★重点章 | 插入/希尔/冒泡/快排/简单选择/堆/归并/基数/外部排序 | `ds-ch08.json` |

## 四、编号与命名规则

```
题目 id   = {c|ds}-ch{NN}-{题型缩写}-{NNN}        例 ds-ch02-pg-001
题型缩写  = cc 程序填空 | dbg 改错 | cr 阅读 | pg 编程 | sc 选择 | tf 判断
            | fb 概念填空 | co 代码排序 | sa 简答 | cx 复杂度 | mt 匹配
分片文件  = public/data/problems/{c|ds}-chNN.json          一章一文件
知识卡片  = {c|ds}-chNN-{节号，点换成下划线}-{语义 slug}    例 c-ch05-5_7_2-continue-vs-break
```

- 序号 `NNN` 在**同一章 + 同一题型**内从 `001` 递增；已删除的编号**不复用**，避免历史 localStorage 进度串题。
- 章号一律两位（`ch05`，不是 `ch5`）。
- `c-chNN-` 前缀必须配 `category: "c"`，`ds-chNN-` 必须配 `category: "ds"`。

## 五、⚠ 待裁决冲突（本表只登记，不擅自改已验收的规范文档）

**冲突 1｜指针是第 8 章还是第 9 章。**
谭浩强第五版的指针是**第 8 章**（第 9 章是「用户自己建立数据类型」），本表按教材目录取 `c-ch08`。
但 `04_题型规范与样例.md` 现有 3 个样例（`c-ch09-cc-001`、`c-ch09-dbg-001`、`c-ch09-cr-001`）与
`08_知识点汇总规范.md` 的示例文件名 `ch09_pointer.json` 都写成**第 9 章 指针**。
影响面：3 个样例 id、它们的 `chapter` / `section` 值（9.1 / 9.2 / 9.3 → 8.1 / 8.2 / 8.3）、08 的示例文件名。
两个选项：

- **A**：把 04 与 08 的这 3 个 id 改成 `c-ch08-*`（对齐教材目录，一次性改动，此后无歧义）；
- **B**：本表给指针保留 `c-ch09`（与教材目录不符，读者按书找章节会对不上）。

本表按 **A** 登记 `c-ch08 = 指针`，但**未改动 04/08**（协作规则第 2 条：已验证通过的文件不擅动）。
在你裁决之前，**不生成指针章的批量题目 id**。本轮 3 道种子题（第5章循环、第6章数组、ds第2章线性表）不受影响。

**冲突 2｜`08_知识点汇总规范.md` 的示例文件名**（`ch01_basics.json` / `ch03_data.json` / `ch05_operator.json`）
用的是 C Primer Plus 的章号，且缺 `c-` / `ds-` 前缀，与本表的 `{c|ds}-chNN.json` 不符。知识卡片要到阶段 5
才生成，故此项**只记录不改文**，阶段 5 开工前一并裁决。

**冲突 3｜数据目录位置**。`00_任务书.md` 第八节写 `src/data/problems/{c|ds}-chXX_主题.json`，而本次裁决与
ADR-0001 第 5 节都指向 `public/data/`。取 `public/data/`：纯静态站只有 `public/` 下的文件会被原样发布，
`src/data/` 要过打包器，与「改数据无需重建 JS chunk」的 fetch 懒加载策略冲突。文件名也不带主题后缀
（`c-ch05.json`），这样「文件名 ↔ id ↔ chapter」三向才能机械校验。

---

## 六、机器可读真源

下面这个 JSON 块是 `scripts/verify-data.ts` 实际解析的对象（本文件最后一个 ```json 块）。
改上面两张表的同时必须改这里；两者不一致时以本块为准，并在阶段报告里报出。

```json
{
  "version": 1,
  "updated": "2026-09-06",
  "problemFileTemplate": "public/data/problems/{category}-ch{no}.json",
  "pendingRulings": [
    "指针章号 c-ch08（本表）与 04/08 文档的 c-ch09 冲突，待裁决"
  ],
  "categories": {
    "c": {
      "prefix": "c-",
      "textbook": "谭浩强《C程序设计》（第五版）第一部分",
      "chapters": [
        {
          "no": "ch01",
          "id_prefix": "c-ch01",
          "chapter": "第1章 程序设计和C语言",
          "textbook_chapter": "程序设计和C语言",
          "file": "c-ch01.json"
        },
        {
          "no": "ch02",
          "id_prefix": "c-ch02",
          "chapter": "第2章 算法——程序的灵魂",
          "textbook_chapter": "算法——程序的灵魂",
          "file": "c-ch02.json"
        },
        {
          "no": "ch03",
          "id_prefix": "c-ch03",
          "chapter": "第3章 最简单的C程序设计——顺序程序设计",
          "textbook_chapter": "最简单的C程序设计——顺序程序设计",
          "file": "c-ch03.json"
        },
        {
          "no": "ch04",
          "id_prefix": "c-ch04",
          "chapter": "第4章 选择结构程序设计",
          "textbook_chapter": "选择结构程序设计",
          "file": "c-ch04.json"
        },
        {
          "no": "ch05",
          "id_prefix": "c-ch05",
          "chapter": "第5章 循环结构程序设计",
          "textbook_chapter": "循环结构程序设计",
          "file": "c-ch05.json"
        },
        {
          "no": "ch06",
          "id_prefix": "c-ch06",
          "chapter": "第6章 利用数组处理批量数据",
          "textbook_chapter": "利用数组处理批量数据",
          "file": "c-ch06.json"
        },
        {
          "no": "ch07",
          "id_prefix": "c-ch07",
          "chapter": "第7章 用函数实现模块化程序设计",
          "textbook_chapter": "用函数实现模块化程序设计",
          "file": "c-ch07.json"
        },
        {
          "no": "ch08",
          "id_prefix": "c-ch08",
          "chapter": "第8章 善于利用指针",
          "textbook_chapter": "善于利用指针 ★重点章",
          "file": "c-ch08.json"
        },
        {
          "no": "ch09",
          "id_prefix": "c-ch09",
          "chapter": "第9章 用户自己建立数据类型",
          "textbook_chapter": "用户自己建立数据类型",
          "file": "c-ch09.json"
        },
        {
          "no": "ch10",
          "id_prefix": "c-ch10",
          "chapter": "第10章 对文件的输入输出",
          "textbook_chapter": "对文件的输入输出",
          "file": "c-ch10.json"
        }
      ]
    },
    "ds": {
      "prefix": "ds-",
      "textbook": "严蔚敏《数据结构（C语言版）第2版》第一部分",
      "chapters": [
        {
          "no": "ch01",
          "id_prefix": "ds-ch01",
          "chapter": "第1章 绪论",
          "textbook_chapter": "绪论",
          "file": "ds-ch01.json"
        },
        {
          "no": "ch02",
          "id_prefix": "ds-ch02",
          "chapter": "第2章 线性表",
          "textbook_chapter": "线性表",
          "file": "ds-ch02.json"
        },
        {
          "no": "ch03",
          "id_prefix": "ds-ch03",
          "chapter": "第3章 栈和队列",
          "textbook_chapter": "栈和队列",
          "file": "ds-ch03.json"
        },
        {
          "no": "ch04",
          "id_prefix": "ds-ch04",
          "chapter": "第4章 串、数组和广义表",
          "textbook_chapter": "串、数组和广义表",
          "file": "ds-ch04.json"
        },
        {
          "no": "ch05",
          "id_prefix": "ds-ch05",
          "chapter": "第5章 树和二叉树",
          "textbook_chapter": "树和二叉树 ★重点章",
          "file": "ds-ch05.json"
        },
        {
          "no": "ch06",
          "id_prefix": "ds-ch06",
          "chapter": "第6章 图",
          "textbook_chapter": "图 ★重点章",
          "file": "ds-ch06.json"
        },
        {
          "no": "ch07",
          "id_prefix": "ds-ch07",
          "chapter": "第7章 查找",
          "textbook_chapter": "查找 ★重点章",
          "file": "ds-ch07.json"
        },
        {
          "no": "ch08",
          "id_prefix": "ds-ch08",
          "chapter": "第8章 排序",
          "textbook_chapter": "排序 ★重点章",
          "file": "ds-ch08.json"
        }
      ]
    }
  }
}
```

