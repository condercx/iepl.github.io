# live2d/ — 本地托管的看板娘资源

这些文件是从第三方 Live2D 看板娘项目镜像到本仓库的，改为同域加载，
不再依赖跨域 CDN，国内访问更快也更稳定。

## 来源

- 控件代码与运行库：https://github.com/letere-gzj/live2d-widget-v3
  - `waifu.css`、`waifu-tips.js`、`waifu-tips.json`
  - `Core/live2dcubismcore.js`（Live2D Cubism Core）
  - `live2d-sdk.js`（对接 Cubism SDK for Web v5）
  - 该项目基于 https://github.com/stevenjoezhang/live2d-widget 二次开发
- 模型 `Rice`：上述项目 `Resources/model/Rice/`，按其 README 说明为
  Live2D 官方 SDK 自带示例模型。

## 本地改动

- `Resources/model_list.json` 只保留 `Rice` 一个条目。原文件列出七个模型，
  这里只镜像了 Rice，保留其余条目会在切换模型时报 404。

## 授权说明

上游仓库未附 LICENSE 文件。此处按上游 README 的用法原样镜像自用，
未作商业分发。Live2D Cubism Core 与示例模型的使用受 Live2D 公司
相关许可约束，如需商用请自行核对 Live2D 的授权条款。
