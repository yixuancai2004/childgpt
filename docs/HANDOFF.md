# 给负责 PPT / 上台展示组员的交接

这是实现和结果交接，不是幻灯片稿。

## 第 3 项：现场讲算法时用哪里

打开 `ChildGPT-demo.html`，点 **Run guided demo**。观察它在未教过时先提问，学会后记住，演示一次明确预设的遗漏，随后根据纠正更新记忆。

**Algorithm trace** 页面展示的是当次程序执行产生的 action、permitted fact、source interaction、mastery、corruption operator 和排名，不是手工写死的演示截图。也可以下载该次 trace JSON。

切换 **Learner B** 并询问 `tavi`，证明 B 未获得 A 的教学内容。切回 A，记忆仍保留。不要把这个演示分区描述为正式的登录账号体系。

讲算法时可以再演示一次自动出错：教两个相关概念（例如 kaya toast 和 kopi，内容用分号分步骤），然后多点几次 **Ask me a question**，Algorithm trace 里会显示掌握度区间、抽样值、出错算子。用引号标出的词（如 “kaya”）会在探索回合被主动提问。

## 第 4 项：拿哪些结果

在 **Evaluation lab** 依次运行 **Run all checks** 和 **Run simulations**。可导出完整 JSON、60 天时间序列 CSV 和 CUSUM SVG。

项目中的 `results/evaluation.json`、`results/SUMMARY.md` 和 `results/synthetic-trace.csv` 是实际执行生成的结果。`results/ui/` 是程序界面截图，方便直接取图，但无需依赖截图才能演示。

默认参数对应的关键事实：96/96 控制器检查通过；稳定序列误报 40/200；变化序列中变化后首次检出 195/200；另有 5/200 在真实变化前已误报；变化后正常检出子集平均延迟 4.13 天（中位数 3 天）；只持续 3 天的短暂波动有 90/200 也会报警。阈值扫描表可以讲误报和延迟之间的取舍，但不要说“我们选了最优 h”。

一定注明：**合成数据、固定示例阈值、未做真实人群实验、并非健康诊断。** 不要把“195/200”说成真实老人抑郁检出率，也不要隐藏 20.0% 的稳定序列误报比例和 45% 的短暂波动报警。

## 上台前 2 分钟检查

1. 打开网页，确认显示 **KEY-FREE DEMO**，无需 Wi-Fi 或模型密钥。
2. 用虚构例子，运行 guided demo；测试完切换回 Learner A。
3. 点开算法页，再打开评估页运行两组检查；下载一次 JSON 检查导出可用。
4. 现场没有 API 时保持无 API 模式；不要在公开网页或投影画面中输入提供商密钥。

API 已留接口，但真实模型请求未验证。当前 API 版本仅做受限原文片段提取与批准表达选择，不是 unrestricted chatbot。
