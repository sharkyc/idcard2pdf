# 身份证图片合并到 A4 PDF

## 功能概述
- 选择两张包含身份证的照片，自动检测身份证四边形并透视矫正
- 支持裁剪留白、自动横向摆放，避免边缘被切掉
- 将正反面以身份证真实尺寸（85.6×54.0 mm）居中排版到 A4 并导出 PDF
- 网页版交互：拖动四角、滚轮/双指缩放、角度微调、A4 实际比例预览
- 移动端优化：双指捏合、摄像头直接拍照上传

## 快速开始
- 安装依赖
  - `pip install -r requirements.txt`
- 桌面 GUI
  - `python idcard2pdf.py`
- 命令行
  - `python idcard2pdf.py --front <正面图片> --back <反面图片> --out <输出.pdf>`
- 网页版
  - `python webserver.py`
  - 浏览器访问 `http://127.0.0.1:5000/`

## 使用说明（网页版）
- 上传正反面图片（支持拖拽或点击）
- 在画布中：
  - 拖动四个红色角点，精确圈定身份证四角
  - 滚轮缩放或双指捏合缩放；单指在空白处拖拽平移
  - 旋转滑杆做角度微调，点击“应用”生成抠图预览
- 右侧“A4 预览”按真实尺寸显示排版效果，点击“导出 PDF”即可下载

## 关键参数
- `extract_idcard(path, pad_px=20, refine=True, rotate_to_landscape=True)`
  - `pad_px`：透视后的四周留白像素，避免边缘裁剪
  - `refine`：抠图精炼；若为 True，保持证件内部不透明
  - `rotate_to_landscape`：自动横向摆放

## 技术要点
- 检测：边缘→轮廓四点→几何筛选长宽比，提取身份证四边形
- 透视：按 `tl,tr,br,bl` 点顺序计算单应矩阵并矫正
- 抠图：可选基于掩码的前景保留，避免证件内部文字被抠掉
- A4 排版：以毫米为单位换算到 PDF 点，真实尺寸绘制

## Docker 部署
- 构建镜像
  - `docker build -t idcard2pdf .`
- 运行容器
  - `docker run -p 8000:5000 -e PORT=5000 idcard2pdf`
- 访问
  - 打开 `http://localhost:8000/`

## Render 部署
- 推送代码到仓库（GitHub/GitLab）
- Render → New → Web Service → 选择你的仓库 → 构建方式选“Use Dockerfile”
- 环境变量：`PORT=5000`（平台通常自动注入），可选 `WEB_CONCURRENCY=2`
- 构建完成后，使用 Render 提供的 URL 访问网页端

## 注意事项
- 复杂背景下建议在网页端手动微调四角与角度
- 上传大小默认限制 20MB（`webserver.py` 可调整）
- 导出 PDF 尺寸为真实身份证大小在 A4 中的居中排版