# enx-ui

基于 Next.js 构建的前端应用。

## 技术栈

| 类别     | 技术                                                                       | 版本   |
|----------|----------------------------------------------------------------------------|--------|
| 框架     | [Next.js](https://nextjs.org)                                              | 15.4.4 |
| 构建工具 | [Turbopack](https://turbo.build/pack)                                      | 内置   |
| UI 库    | [React](https://react.dev)                                                 | 19.2.6 |
| 语言     | TypeScript                                                                 | ^5     |
| 样式     | [Tailwind CSS](https://tailwindcss.com)                                    | ^4     |
| UI 组件  | [Radix UI](https://www.radix-ui.com)                                       | -      |
| 状态管理 | [Jotai](https://jotai.org)                                                 | ^2     |
| 数据请求 | [TanStack Query](https://tanstack.com/query)                               | ^5     |
| 表单     | [React Hook Form](https://react-hook-form.com) + [Zod](https://zod.dev)    | -      |
| 图标     | [Lucide React](https://lucide.dev)                                         | -      |
| 错误监控 | [Sentry](https://sentry.io)                                                | ^9     |
| 测试     | [Jest](https://jestjs.io) + [Testing Library](https://testing-library.com) | -      |
| 代码格式 | [Prettier](https://prettier.io) + [ESLint](https://eslint.org)             | -      |

## 快速开始

```bash
npm run dev
```

打开 [http://localhost:3000](http://localhost:3000) 查看应用。

## 常用命令

```bash
npm run dev        # 启动开发服务器（Turbopack）
npm run build      # 构建生产版本
npm run start      # 启动生产服务器
npm run test       # 运行测试
npm run lint       # 代码检查
npm run format     # 代码格式化
```
