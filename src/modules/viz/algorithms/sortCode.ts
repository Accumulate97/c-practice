/**
 * 8 种排序的对照 C 源码（标准 C99，仅上屏展示，不编译）。
 * 键 = 演示 id。演示页右侧「代码」面板按行号渲染；本批不做逐步高亮（codeLine），
 * 代码作为算法对照参考，逐行同步高亮留到会话 2 打磨。
 * 注意：这些片段不含 printf，故模板字符串里没有需要转义的 \n。
 */
export const SORT_CODE: Record<string, string> = {
  'sort-bubble': `void bubbleSort(int a[], int n) {
    for (int i = 0; i < n - 1; i++) {          /* 共 n-1 趟 */
        for (int j = 0; j < n - 1 - i; j++) {   /* 每趟两两比较 */
            if (a[j] > a[j + 1]) {              /* 逆序则交换，把大值后移 */
                int t = a[j];
                a[j] = a[j + 1];
                a[j + 1] = t;
            }
        }
    }
}`,
  'sort-selection': `void selectionSort(int a[], int n) {
    for (int i = 0; i < n - 1; i++) {
        int min = i;                            /* 记录最小值下标 */
        for (int j = i + 1; j < n; j++)
            if (a[j] < a[min]) min = j;
        if (min != i) {                         /* 把最小值换到 a[i] */
            int t = a[i]; a[i] = a[min]; a[min] = t;
        }
    }
}`,
  'sort-insertion': `void insertionSort(int a[], int n) {
    for (int i = 1; i < n; i++) {
        int key = a[i];                         /* 待插入元素 */
        int j = i - 1;
        while (j >= 0 && a[j] > key) {          /* 比 key 大的都右移 */
            a[j + 1] = a[j];
            j--;
        }
        a[j + 1] = key;                         /* 落位 */
    }
}`,
  'sort-shell': `void shellSort(int a[], int n) {
    for (int gap = n / 2; gap >= 1; gap /= 2) {  /* 增量逐次减半 */
        for (int i = gap; i < n; i++) {
            int key = a[i];
            int j = i;
            while (j >= gap && a[j - gap] > key) {
                a[j] = a[j - gap];              /* 间隔 gap 的插入排序 */
                j -= gap;
            }
            a[j] = key;
        }
    }
}`,
  'sort-merge': `void merge(int a[], int lo, int mid, int hi, int aux[]) {
    int i = lo, j = mid, k = lo;
    while (i < mid && j < hi)                   /* 两段有序，取较小者 */
        aux[k++] = (a[i] <= a[j]) ? a[i++] : a[j++];
    while (i < mid) aux[k++] = a[i++];          /* 收尾左段 */
    while (j < hi)  aux[k++] = a[j++];          /* 收尾右段 */
    for (int t = lo; t < hi; t++) a[t] = aux[t];/* 拷回原数组 */
}

void mergeSort(int a[], int lo, int hi, int aux[]) {  /* 区间 [lo, hi) */
    if (hi - lo <= 1) return;
    int mid = (lo + hi) / 2;
    mergeSort(a, lo, mid, aux);
    mergeSort(a, mid, hi, aux);
    merge(a, lo, mid, hi, aux);
}`,
  'sort-quick': `void quickSort(int a[], int lo, int hi) {
    if (lo >= hi) return;
    int pivot = a[hi];                          /* 取末元素为基准 */
    int i = lo - 1;                             /* i 是「小于区」右边界 */
    for (int j = lo; j < hi; j++) {
        if (a[j] < pivot) {
            i++;
            int t = a[i]; a[i] = a[j]; a[j] = t;
        }
    }
    int t = a[i + 1]; a[i + 1] = a[hi]; a[hi] = t;  /* 基准归位 */
    int p = i + 1;
    quickSort(a, lo, p - 1);
    quickSort(a, p + 1, hi);
}`,
  'sort-heapsort': `void siftDown(int a[], int root, int end) {     /* 在 [0, end) 内下沉 */
    while (2 * root + 1 < end) {
        int child = 2 * root + 1;
        if (child + 1 < end && a[child + 1] > a[child]) child++;  /* 取大孩子 */
        if (a[child] > a[root]) {
            int t = a[child]; a[child] = a[root]; a[root] = t;
            root = child;
        } else break;
    }
}

void heapSort(int a[], int n) {
    for (int i = n / 2 - 1; i >= 0; i--) siftDown(a, i, n);  /* 建大顶堆 */
    for (int end = n - 1; end > 0; end--) {
        int t = a[0]; a[0] = a[end]; a[end] = t;             /* 堆顶换到末尾 */
        siftDown(a, 0, end);
    }
}`,
  'sort-radix': `void radixSort(int a[], int n) {                /* LSD，非负整数 */
    int max = 0;
    for (int i = 0; i < n; i++) if (a[i] > max) max = a[i];
    int out[n];                                 /* C99 变长数组作缓冲 */
    for (int exp = 1; max / exp > 0; exp *= 10) {
        int count[10] = {0};
        for (int i = 0; i < n; i++) count[(a[i] / exp) % 10]++;  /* 分配 */
        for (int d = 1; d < 10; d++) count[d] += count[d - 1];   /* 前缀和 */
        for (int i = n - 1; i >= 0; i--) {                       /* 倒序收集保稳定 */
            int d = (a[i] / exp) % 10;
            out[--count[d]] = a[i];
        }
        for (int i = 0; i < n; i++) a[i] = out[i];
    }
}`,
}