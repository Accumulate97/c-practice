/**
 * R2–R5 演示的对照 C 源码（标准 C，仅上屏展示、不编译）。
 *
 * 键 = 演示 id，与 index.ts 的 VIZ_SPECS 一一对应；steps[].codeLine 指向这里的 1-based 行号。
 * 三条纪律（AGENTS.md 二·6 / 05_教材代码风格约定.md）：
 *   1. 只写能编译的标准 C —— 不用 C++ 语法，不用严蔚敏教材的类 C 伪码；
 *   2. 不用 gets / conio.h / getch / system("pause")；
 *   3. 指针修改顺序必须与演示步骤严格一致（先连后断），这是学生最易错处。
 */
export const VIZ_CODE: Record<string, string> = {
  'linear-singly-delete': `struct Node { int data; struct Node *next; };

/* 删除第一个 data == v 的结点：pre 始终落后 p 一个身位 */
int listDelete(struct Node **head, int v) {
    struct Node *p = *head, *pre = NULL;
    while (p != NULL && p->data != v) {   /* 找目标，记住前驱 */
        pre = p;
        p = p->next;
    }
    if (p == NULL) return 0;              /* 没找到 */
    if (pre == NULL) *head = p->next;     /* 删的是头结点 */
    else             pre->next = p->next; /* 先连：绕过 p */
    free(p);                              /* 后断：释放 p */
    return 1;
}`,

  'linear-doubly-insert-delete': `struct DNode { int data; struct DNode *prev, *next; };

/* 在 p 之后插入 x：4 次指针修改，顺序不能乱 */
void insertAfter(struct DNode *p, struct DNode *x) {
    x->prev = p;          /* 1 新结点先接住前驱 */
    x->next = p->next;    /* 2 再接住后继（必须在改 p->next 之前） */
    if (p->next != NULL) p->next->prev = x;  /* 3 后继回指 */
    p->next = x;          /* 4 前驱后指 */
}

/* 摘掉 x：2 次指针修改，x 的前后自己接上 */
void removeNode(struct DNode *x) {
    if (x->prev != NULL) x->prev->next = x->next;
    if (x->next != NULL) x->next->prev = x->prev;
    free(x);
}`,

  'linear-stack-push-pop': `#define MAXSIZE 5
typedef struct { int data[MAXSIZE]; int top; } Stack;   /* top = -1 表示空栈 */

int push(Stack *s, int e) {
    if (s->top == MAXSIZE - 1) return 0;   /* 栈满，再压就溢出 */
    s->data[++s->top] = e;                 /* 先移 top，再存值 */
    return 1;
}

int pop(Stack *s, int *e) {
    if (s->top == -1) return 0;            /* 栈空，无值可弹 */
    *e = s->data[s->top--];                /* 先取值，再退 top */
    return 1;
}`,

  'linear-queue-enqueue-dequeue': `#define MAXQ 5
typedef struct { int data[MAXQ]; int front, rear; } CQueue;
/* 循环队列：少用一个单元，队满条件是 (rear+1)%MAXQ == front */

int enQueue(CQueue *q, int e) {
    if ((q->rear + 1) % MAXQ == q->front) return 0;   /* 队满 */
    q->data[q->rear] = e;
    q->rear = (q->rear + 1) % MAXQ;                   /* rear 走到尾就绕回 0 */
    return 1;
}

int deQueue(CQueue *q, int *e) {
    if (q->front == q->rear) return 0;                /* 队空 */
    *e = q->data[q->front];
    q->front = (q->front + 1) % MAXQ;
    return 1;
}`,

  'linear-circular-list': `struct Node { int data; struct Node *next; };

/* 单循环链表：尾结点的 next 指回头结点，不是 NULL */
/* 尾插法建表只留 tail 指针，插入 O(1)，不必每次绕一圈找尾巴 */
void insertAfterTail(struct Node **tail, int v) {
    struct Node *nw = malloc(sizeof(struct Node));
    nw->data = v;
    nw->next = (*tail)->next;   /* 1 先连：新结点指回头结点 */
    (*tail)->next = nw;         /* 2 后改：原尾结点指向新结点 */
    *tail = nw;                 /* 3 tail 前移 */
}

int length(const struct Node *head) {
    const struct Node *p = head;
    int n = 0;
    do { n++; p = p->next; } while (p != head);   /* 绕回起点才停 */
    return n;
}`,

  'tree-preorder': `struct TNode { char data; struct TNode *left, *right; };

/* 先序：根 → 左 → 右。递归的三条语句顺序就是访问顺序 */
void preOrder(const struct TNode *t) {
    if (t == NULL) return;
    printf("%c ", t->data);   /* 1 访问根 */
    preOrder(t->left);        /* 2 先序遍历左子树 */
    preOrder(t->right);       /* 3 先序遍历右子树 */
}`,

  'tree-inorder': `struct TNode { char data; struct TNode *left, *right; };

/* 中序：左 → 根 → 右。BST 的中序序列必然递增 */
void inOrder(const struct TNode *t) {
    if (t == NULL) return;
    inOrder(t->left);         /* 1 中序遍历左子树 */
    printf("%c ", t->data);   /* 2 访问根 */
    inOrder(t->right);        /* 3 中序遍历右子树 */
}`,

  'tree-postorder': `struct TNode { char data; struct TNode *left, *right; };

/* 后序：左 → 右 → 根。销毁树、算树高都用后序（先处理完孩子才轮到根） */
void postOrder(const struct TNode *t) {
    if (t == NULL) return;
    postOrder(t->left);       /* 1 后序遍历左子树 */
    postOrder(t->right);      /* 2 后序遍历右子树 */
    printf("%c ", t->data);   /* 3 访问根 */
}`,

  'tree-bst-delete': `struct TNode { int key; struct TNode *left, *right; };

/* 三种情形：叶子直接删；单孩子让孩子顶上来；双孩子用中序后继替身 */
struct TNode *bstDelete(struct TNode *t, int v) {
    if (t == NULL) return NULL;
    if (v < t->key)      t->left  = bstDelete(t->left,  v);
    else if (v > t->key) t->right = bstDelete(t->right, v);
    else if (t->left && t->right) {          /* 双孩子：找右子树最小值 */
        struct TNode *s = t->right;
        while (s->left) s = s->left;
        t->key = s->key;                     /* 后继的值抄上来 */
        t->right = bstDelete(t->right, s->key);
    } else {                                 /* 0 或 1 个孩子 */
        struct TNode *c = t->left ? t->left : t->right;
        free(t);
        return c;
    }
    return t;
}`,

  'tree-heap-build': `/* 大根堆：a[i] >= a[2i+1] 且 a[i] >= a[2i+2] */
/* 建堆 = 从最后一个非叶结点 n/2-1 起，倒着逐个向下筛选，总代价 O(n) */
void siftDown(int a[], int i, int n) {
    for (int c = 2 * i + 1; c < n; i = c, c = 2 * i + 1) {
        if (c + 1 < n && a[c + 1] > a[c]) c++;   /* 取较大的孩子 */
        if (a[i] >= a[c]) break;                 /* 已经比孩子大，停 */
        int t = a[i]; a[i] = a[c]; a[c] = t;     /* 下沉 */
    }
}

void buildMaxHeap(int a[], int n) {
    for (int i = n / 2 - 1; i >= 0; i--) siftDown(a, i, n);
}`,

  'tree-avl-rotate': `struct ANode { int key, height; struct ANode *left, *right; };
static int h(const struct ANode *n) { return n ? n->height : 0; }
static int bf(const struct ANode *n) { return h(n->left) - h(n->right); }

struct ANode *rotateR(struct ANode *y) {   /* LL：右单旋 */
    struct ANode *x = y->left;
    y->left = x->right;                    /* x 的右子树挂给 y */
    x->right = y;                          /* y 变成 x 的右孩子 */
    y->height = 1 + (h(y->left) > h(y->right) ? h(y->left) : h(y->right));
    x->height = 1 + (h(x->left) > h(x->right) ? h(x->left) : h(x->right));
    return x;                              /* 新根是 x */
}

struct ANode *rotateL(struct ANode *x) {   /* RR：左单旋，与上对称 */
    struct ANode *y = x->right;
    x->right = y->left;
    y->left = x;
    x->height = 1 + (h(x->left) > h(x->right) ? h(x->left) : h(x->right));
    y->height = 1 + (h(y->left) > h(y->right) ? h(y->left) : h(y->right));
    return y;
}
/* LR = 先对左孩子左旋，再对自己右旋；RL = 先对右孩子右旋，再对自己左旋 */`,

  'tree-huffman': `struct HNode { int weight; struct HNode *left, *right; };

/* n 个叶子要合并 n-1 次；每次从森林里挑两棵权值最小的 */
struct HNode *huffmanTree(int w[], int n) {
    struct HNode *forest[64];
    for (int i = 0; i < n; i++) {
        forest[i] = malloc(sizeof(struct HNode));
        forest[i]->weight = w[i];
        forest[i]->left = forest[i]->right = NULL;
    }
    int m = n;
    while (m > 1) {
        int i1 = 0, i2 = 1;
        if (forest[i1]->weight > forest[i2]->weight) { int t = i1; i1 = i2; i2 = t; }
        for (int i = 2; i < m; i++) {              /* 选出最小的两个下标 */
            if (forest[i]->weight < forest[i1]->weight) { i2 = i1; i1 = i; }
            else if (forest[i]->weight < forest[i2]->weight) i2 = i;
        }
        struct HNode *p = malloc(sizeof(struct HNode));
        p->weight = forest[i1]->weight + forest[i2]->weight;
        p->left = forest[i1]; p->right = forest[i2];
        forest[i1] = p;                            /* 新树放回森林 */
        forest[i2] = forest[--m];                  /* 末尾元素补空位 */
    }
    return forest[0];
}`,

  'graph-dfs': `/* 邻接矩阵存储，n 个顶点编号 0..n-1 */
void dfs(int u, int n, const int adj[][n], int visited[]) {
    visited[u] = 1;
    printf("%c ", 'A' + u);            /* 1 访问 u */
    for (int v = 0; v < n; v++)
        if (adj[u][v] && !visited[v])  /* 2 挑一个未访问的邻居 */
            dfs(v, n, adj, visited);   /* 3 一路走到底才回头 */
}`,

  'graph-dijkstra': `#define INF 1000000
/* dist[v] = 源点到 v 的当前最短长度；used[v] = v 是否已并入 S 集 */
void dijkstra(int s, int n, const int g[][n], int dist[], int used[]) {
    for (int v = 0; v < n; v++) { dist[v] = g[s][v]; used[v] = 0; }
    dist[s] = 0; used[s] = 1;
    for (int k = 1; k < n; k++) {
        int u = -1, best = INF;
        for (int v = 0; v < n; v++)                /* 选 S 外最近的 u */
            if (!used[v] && dist[v] < best) { best = dist[v]; u = v; }
        used[u] = 1;
        for (int v = 0; v < n; v++)                /* 松弛：经 u 中转能否更近 */
            if (!used[v] && dist[u] + g[u][v] < dist[v])
                dist[v] = dist[u] + g[u][v];
    }
}`,

  'graph-prim': `#define INF 1000000
/* 从 v0 出发，每轮把「一端在 U 内、另一端在 U 外」的最小边并入 */
void prim(int v0, int n, const int g[][n]) {
    int lowcost[n], inU[n];
    for (int v = 0; v < n; v++) { lowcost[v] = g[v0][v]; inU[v] = 0; }
    inU[v0] = 1; lowcost[v0] = 0;
    for (int k = 1; k < n; k++) {
        int u = -1, best = INF;
        for (int v = 0; v < n; v++)
            if (!inU[v] && lowcost[v] < best) { best = lowcost[v]; u = v; }
        inU[u] = 1;                                /* u 并入 U */
        for (int v = 0; v < n; v++)
            if (!inU[v] && g[u][v] < lowcost[v]) lowcost[v] = g[u][v];
    }
}`,

  'graph-kruskal': `struct Edge { int u, v, w; };
int parent[MAXN];                                  /* 并查集：parent[x] 是 x 的双亲 */

int findRoot(int x) {
    while (parent[x] != x) x = parent[x];
    return x;
}

/* 边按权值升序排好，逐条考察：两端不在同一棵树才收，收了就合并 */
void kruskal(struct Edge e[], int m, int n) {
    for (int i = 0; i < n; i++) parent[i] = i;
    int taken = 0;
    for (int i = 0; i < m && taken < n - 1; i++) {
        int ru = findRoot(e[i].u), rv = findRoot(e[i].v);
        if (ru != rv) {                            /* 不成环 */
            parent[ru] = rv;                       /* 两棵树合并 */
            taken++;
        }
    }
}`,

  'graph-toposort': `/* 拓扑排序：反复摘掉入度为 0 的顶点，摘完 n 个说明无环 */
void topoSort(int n, const int adj[][n], int indeg[]) {
    int stack[MAXN], top = 0, cnt = 0;
    for (int v = 0; v < n; v++)
        for (int u = 0; u < n; u++) if (adj[u][v]) indeg[v]++;
    for (int v = 0; v < n; v++) if (indeg[v] == 0) stack[top++] = v;
    while (top > 0) {
        int u = stack[--top];
        printf("%c ", 'A' + u);
        cnt++;
        for (int v = 0; v < n; v++)
            if (adj[u][v] && --indeg[v] == 0) stack[top++] = v;
    }
    if (cnt < n) printf("有环，无拓扑序列\\n");
}`,

  'memory-pointer-address': `int main(void) {
    int i = 42;          /* i 占 4 字节，假设地址 0x1000 */
    int *p;              /* p 是一个指针变量，自己也要占内存 */
    p = &i;              /* 把 i 的地址存进 p：p 指向 i */
    *p = 99;             /* 解引用：改的是 0x1000 上的 i，不是 p */
    printf("%d\\n", i);   /* 99 */
    p = p + 1;           /* 指针加 1 = 跳过 sizeof(int) 个字节，指向 0x1004 */
    return 0;
}`,

  'memory-array-layout': `int main(void) {
    int a[5] = {10, 20, 30, 40, 50};   /* 5 个 int 连续存放：0x1000 起每格 +4 */
    int *p = a;                        /* 数组名退化为首元素地址，p == &a[0] */

    /* 下面四种写法完全等价，都是「基地址 + 偏移 * sizeof(int)」 */
    a[2]    == *(a + 2);
    p[2]    == *(p + 2);
    *(a+2)  == 30;

    p++;                    /* p 指向 a[1]，地址 0x1004 */
    *(p + 1) = 99;          /* 改的是 a[2] */
    return 0;
}`,

  'memory-call-stack': `int g(int x) {
    int t = x * 2;          /* g 的栈帧：形参 x + 局部变量 t + 返回地址 */
    return t;
}

int f(int a) {
    int b = 1;              /* f 的栈帧压在 main 之上 */
    return a + b + g(a);    /* 调用 g 时再压一层，g 返回后立即弹出 */
}

int main(void) {
    int m = 3;
    return f(m);            /* main 的栈帧最先压入、最后弹出 */
}`,

  'memory-multi-pointer': `int main(void) {
    int   i  = 7;        /* 0x1000 */
    int  *p  = &i;       /* 0x2000，存 0x1000 */
    int **pp = &p;       /* 0x3000，存 0x2000 */

    *pp  = &i;           /* 改 p 本身（*pp 就是 p） */
    **pp = 8;            /* 改 i：先解一层拿到 p，再解一层拿到 i */
    ***(&pp) = 9;        /* 三级解引用，等价于 i = 9 */
    return 0;
}`,

  'memory-malloc-free': `#include <stdlib.h>

int main(void) {
    int *p = malloc(sizeof(int));   /* 堆上申请 4 字节，假设得到 0x5000 */
    if (p == NULL) return 1;        /* 申请失败必须判空 */
    *p = 42;                        /* 只有 p 有效时才能解引用 */

    free(p);                        /* 归还给堆；p 的值没变，但已不可用 */
    /* *p = 7;  ← 访问已释放内存：未定义行为，这就是野指针 */

    p = NULL;                       /* 置空后误用会立刻崩，比悄悄写坏内存好 */
    free(p);                        /* free(NULL) 是安全的空操作 */
    return 0;
}`,
}
