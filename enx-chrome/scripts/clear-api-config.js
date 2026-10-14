// 清除 Chrome Storage 中的 API 地址配置
// 在浏览器控制台中运行此脚本

;(async () => {
  try {
    console.log('🧹 清除 Chrome Storage 中的 API 配置...')

    // 查看当前存储的 API URL
    const current = await chrome.storage.local.get(['apiBaseUrl'])
    console.log('当前存储的 API URL:', current.apiBaseUrl || '(未设置)')

    // 清除 API URL 配置
    await chrome.storage.local.remove(['apiBaseUrl'])

    console.log('✅ API 配置已清除，将使用默认配置')
    console.log('📝 开发环境默认: http://localhost:8091')
    console.log('🔄 请重新加载扩展或刷新页面')

    // 验证清除成功
    const after = await chrome.storage.local.get(['apiBaseUrl'])
    console.log(
      '清除后的 API URL:',
      after.apiBaseUrl || '(未设置，将使用默认值)'
    )
  } catch (error) {
    console.error('❌ 清除失败:', error)
  }
})()
