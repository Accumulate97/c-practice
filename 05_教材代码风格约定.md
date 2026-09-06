# 教材代码风格约定（重要：区分"类C伪码"与"可编译C"）

本文件说明几本教材各自的代码书写风格，以及**在线判题场景下必须遵守的底线**。

---

## ⚠️ 第一原则：判题网站只接受标准 C，拒绝类C伪码

C practice 的所有题目代码要送进 **gcc 编译运行**。因此：

| 可用 | 禁用 |
|---|---|
| 标准 C89/C99 语法 | 严蔚敏教材的"类C语言"伪码 |
| `malloc` / `free` | `new` / `delete`（C++ 语法） |
| `scanf` / `printf` | `cin` / `cout`（C++ 语法） |
| 指针传递 `int *x` | 引用参数 `int &x`（C++ 语法） |
| `int` 返回值 + 状态码宏 | `Status` 类型配合引用参数 |

**这是硬性要求。** 下面分别说明两本教材的风格，目的是让你理解背景，
**不是让你模仿伪码风格**。

---

## 一、严蔚敏《数据结构（C语言版）第2版》—— 类C语言

该教材明确说明：采用**介于伪码和 C 语言之间的类C语言**作为描述工具。
它做了若干扩充，这些扩充**都不是标准 C**。

### 1. 预定义常量与状态类型
```c
#define OK      1
#define ERROR   0
#define OVERFLOW -2
typedef int Status;
```

### 2. 数据元素类型约定
统一用 `ElemType` 表示，由使用者自行定义：
```c
typedef int ElemType;      // 或 typedef struct { ... } ElemType;
```

### 3. 引用参数（C++ 特性，非标准 C）
形参表中以 `&` 打头的参数为引用参数，形参变化会影响实参：
```c
void Create(Complex &C, float x, float y);   // ❌ 不可编译
```
**转为标准 C 应为：**
```c
void Create(Complex *C, float x, float y);   // ✅
```

### 4. 动态内存（C++ 特性）
```c
p = new DataType;    // ❌
delete p;            // ❌
```
**标准 C：**
```c
p = (DataType *)malloc(sizeof(DataType));    // ✅
free(p);                                     // ✅
```

### 5. 输入输出（C++ 流式）
```c
cin >> x;            // ❌
cout << x;           // ❌
```
**标准 C：**
```c
scanf("%d", &x);     // ✅
printf("%d", x);     // ✅
```

### 6. 扩充的赋值语句
- 成组赋值：`(x, y) = (y, x);`
- 交换赋值：`x <--> y;`
- 条件赋值：`x = cond ? a : b;`（这个标准 C 支持）

### 7. 抽象数据类型定义格式
```
ADT 抽象数据类型名 {
    数据对象：〈数据对象的定义〉
    数据关系：〈数据关系的定义〉
    基本操作：〈基本操作的定义〉
} ADT 抽象数据类型名
```
基本操作定义格式：
```
基本操作名(参数表)
    初始条件：〈初始条件描述〉
    操作结果：〈操作结果描述〉
```

### 8. 该教材的典型算法片段（原文）
```
Status ListDelete(SqList &L, int i)
{ // 在顺序表L中删除第i个元素
    if((i<1) || (i>L.length)) return ERROR;
    for (j=i; j<=L.length-1; j++)
        L.elem[j-1] = L.elem[j];
    --L.length;
    return OK;
}
```
> 注意：`&L` 是引用，且省略了 `j` 的声明——这是教材的简化写法。
> **出题时必须补全为可编译的标准 C。**

---

## 二、朱战立《数据结构——使用C语言（第5版）》—— 真实可编译 C

该教材采用**标准 C 语言**描述算法，并声明所有算法都经上机调试通过。
**出题风格应优先对齐这本。**

### 1. 抽象数据元素类型
```c
typedef int DataType;              // 抽象数据元素类型
// 或具体类型
typedef struct Student {
    long number;
    char name[10];
    char sex[3];
    int age;
} StudentType;
```

### 2. 典型算法示例（原文，可直接编译）

**数组逆置（非就地）**
```c
void Reverse(DataType a[], int n, DataType b[])
{
    int i;
    for(i = 0; i < n; i++)
        b[i] = a[n-1-i];
}
```

**数组就地逆置**
```c
void Reverse(DataType a[], int n)
{
    int i, m = n/2;
    DataType temp;
    for(i = 0; i < m; i++)
    {
        temp = a[i];
        a[i] = a[n-1-i];
        a[n-1-i] = temp;
    }
}
```

### 3. 风格特征
- 函数返回 `void`，结果通过数组/指针参数带出
- 变量声明在函数体开头（C89 风格）
- 大括号独占一行，缩进 4 空格
- 有适度注释说明算法要点

---

## 三、大话数据结构 —— C90 标准

该教材作者明确说明：**全部代码改成 C90 标准**，原因是"让代码可以在低端编译环境通过"。

### 必须遵守的 C90 约束
| 要求 | C90 写法 | C99 写法（禁用） |
|---|---|---|
| 注释 | `/* 注释 */` | `// 注释` |
| 变量声明位置 | 函数体开头 | `for(int i=0; ...)` |
| 引用参数 | `void Create(BiTree *T)` | `void Create(BiTree &T)` |

### 该教材的典型命名与结构
```c
typedef int Status;        /* Status是函数的类型,其值是函数结果状态代码 */
typedef int ElemType;      /* ElemType类型根据实际情况而定 */

typedef struct Node
{
    ElemType data;
    struct Node *next;
} Node;
typedef struct Node *LinkList;
```

> ⚠️ 实测提醒：该教材 PDF 的文字层存在 OCR 损伤
> （如 `typedef stru'ot DulNode`、`ElemType dat事J`）。
> **不要从 PDF 正文抄代码**，按上述风格自行编写正确的 C 代码。

---

## 四、C practice 出题的统一代码规范

综合以上，**所有题目中的 C 代码必须满足**：

### 1. 编译标准
统一按 **C99** 编译（Piston 的 gcc 默认即支持）。
允许单行 `//` 注释，但**变量声明仍建议放在块开头**以提升可读性。

### 2. 结构模板
```c
#include <stdio.h>

/* 必要的宏与类型定义 */

int main(void)
{
    /* 变量声明 */

    /* 输入 */

    /* 处理 */

    /* 输出 */

    return 0;
}
```

### 3. 必须包含 `main`
每道编程题/代码阅读题/改错题的代码都必须是**完整可编译程序**，
不能只给函数片段（除非题目明确要求补全函数，此时需提供完整的测试框架）。

### 4. 输入输出
- 用 `scanf` / `printf`
- 输出末尾必须有换行 `\n`
- 格式严格匹配测试用例的 `expected`（包括空格与换行）

### 5. 禁止事项
- ❌ 不使用 `gets()`（已废弃，且不安全）
- ❌ 不使用 `conio.h`、`getch()` 等非标准头文件
- ❌ 不使用 `system("pause")`
- ❌ 不依赖特定编译器的扩展特性
- ❌ 不使用 C++ 语法

### 6. 指针类题目的额外要求
指针是全书最大考点，出题时注意：
- 涉及 `malloc` 的题目，参考实现中应检查返回值是否为 `NULL`
- 涉及字符串时，明确 `'\0'` 的空间
- 改错题优先从以下 bug 库选题（见 `04_题型规范与样例.md`）

---

## 五、数据结构题目的特殊说明

数据结构章节的题目（链表、栈、队列、树、图、排序、查找）与 C 语言基础题不同：

1. **结构体定义要完整给出**，不能只写 `ElemType` 让学生猜
   ```c
   typedef struct LNode {
       int data;
       struct LNode *next;
   } LNode, *LinkList;
   ```

2. **抽象类型具象化**：直接用 `int` 而不是 `ElemType`，
   降低初学者的理解负担，也让代码可直接编译

3. **测试用例要覆盖**：空表、单元素、表头、表尾、越界

4. **涉及动态内存时**，在解析中提醒 `free` 的时机

5. **图/树类题目**，输入格式要给出明确的构造方式，例如：
   ```
   输入格式：
     第1行：结点数 n
     第2行：n 个结点的值
     第3行：边数 m
     接下来 m 行：每行两个整数 u v，表示一条边
   ```
