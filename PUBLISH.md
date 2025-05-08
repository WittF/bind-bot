# 发布指南

本文档提供将koishi-plugin-bind-mcid插件发布到GitHub和NPM的详细步骤。

## 前期准备

1. 确保你已经安装了Node.js和npm
2. 确保你有GitHub账号和NPM账号
3. 确保你已经在本地登录NPM账号 (`npm login`)

## 发布到GitHub

### 初始化Git仓库（如果尚未初始化）

```bash
cd bind-mcid
git init
```

### 创建.gitignore文件

```bash
# 在项目根目录创建.gitignore文件
cat > .gitignore << EOF
node_modules/
dist/
lib/
.DS_Store
*.log
.idea/
.vscode/
*.tsbuildinfo
EOF
```

### 编译TypeScript代码

```bash
# 编译代码
npm run build
```

### 提交代码

```bash
# 添加所有文件到暂存区
git add .

# 提交更改
git commit -m "v1.3.0: 添加消息自动撤回功能和主人专用重置命令"
```

### 创建GitHub仓库

1. 访问 https://github.com/new
2. 填写仓库名称 "koishi-plugin-bind-mcid"
3. 添加简短描述 "适用于Koishi框架的Minecraft账号绑定插件"
4. 选择公开仓库
5. 点击 "Create repository"

### 推送到GitHub

```bash
# 添加远程仓库
git remote add origin https://github.com/你的用户名/koishi-plugin-bind-mcid.git

# 推送到GitHub
git push -u origin main  # 或master，取决于你的默认分支名称
```

### 创建发布标签

1. 在GitHub仓库页面点击 "Releases" > "Create a new release"
2. 输入标签 "v1.3.0"
3. 标题填写 "v1.3.0"
4. 在描述中填写变更日志（从README中复制）
5. 点击 "Publish release"

## 发布到NPM

### 确保package.json配置正确

1. 检查版本号是否更新为 "1.3.0"
2. 确保所有依赖项都正确列出
3. 确保 "main" 和 "typings" 字段正确指向编译后的文件

### 登录NPM（如果尚未登录）

```bash
npm login
```

### 测试打包

```bash
# 创建一个打包测试
npm pack
```

这会创建一个 .tgz 文件，检查这个文件包含的内容是否符合预期。

### 发布到NPM

```bash
# 发布到NPM
npm publish
```

如果需要发布到自定义的NPM源，可以使用：

```bash
npm publish --registry=https://your-registry-url
```

### 验证发布

发布完成后，你可以通过以下命令验证是否发布成功：

```bash
npm view koishi-plugin-bind-mcid
```

## 更新现有发布

每次进行新版本更新时，请按照以下步骤操作：

1. 更新代码
2. 更新package.json中的版本号
3. 更新README.md中的版本历史
4. 编译代码 `npm run build`
5. 提交更改并推送到GitHub
   ```bash
   git add .
   git commit -m "vX.Y.Z: 版本描述"
   git push
   ```
6. 在GitHub上创建新的发布标签
7. 发布到NPM
   ```bash
   npm publish
   ```

## 常见问题

### NPM发布权限问题

如果遇到权限错误，可能是因为：

1. 未登录NPM账号
2. 账号没有该包的发布权限
3. 包名已被占用

解决方案：

```bash
# 重新登录
npm login

# 或使用作用域包(scoped package)
# 修改package.json中的name为"@你的用户名/koishi-plugin-bind-mcid"
# 然后发布
npm publish --access public
```

### GitHub推送问题

如果无法推送到GitHub，可能是因为：

1. 远程仓库URL错误
2. 没有推送权限
3. 本地分支与远程分支存在冲突

解决方案：

```bash
# 检查远程仓库URL
git remote -v

# 如果需要，更新远程仓库URL
git remote set-url origin https://github.com/你的用户名/koishi-plugin-bind-mcid.git

# 拉取远程更改并解决冲突
git pull origin main --rebase
# 解决冲突后
git push origin main
``` 