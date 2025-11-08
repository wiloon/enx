# Language Compliance

## Overview

This document tracks compliance with the project's language requirements as specified in `/AGENTS.md`:

> **Language Requirements**: Use English for all code, comments, documentation, and configuration files to maintain consistency across the project

## Recent Changes (2025-11-08)

### Issue Identified

The Chrome extension contained Chinese text in user-facing alert dialogs, violating the English-only requirement.

### Changes Made

#### 1. Replaced Alert Dialogs with Error Display Area

**Before**: Used `alert()` with Chinese text
**After**: Use `setError()` to display messages in the popup's error area

**Rationale**:

- Chrome extension popups have limited screen space
- Alert dialogs are intrusive and block the UI
- Error messages in the UI are more user-friendly and don't require dismissal

#### 2. Translated All User-Facing Messages

All error messages and status text were translated from Chinese to English:

| Chinese                           | English                                                                                                         |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `无法找到当前标签页`              | `Failed to find active tab`                                                                                     |
| `此页面不支持学习模式`            | `This page is not supported. Supported sites: ...`                                                              |
| `学习模式已启用,但文章处理未完成` | `Article processing incomplete. Possible reasons: ...`                                                          |
| `启动学习模式失败`                | `Failed to enable learning mode. Check console for details.`                                                    |
| `无法在此页面启动学习模式`        | `Cannot enable learning mode on this page. It may not be in the supported list or has permission restrictions.` |
| `启动失败: 未知错误`              | `Activation failed: Unknown error`                                                                              |

#### 3. Added Error Display in Logged-In View

**File**: `src/components/Login.tsx`

**Before**: No error display area in logged-in state
**After**: Added error display component below welcome message

```tsx
{
  error && (
    <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
      {error}
    </div>
  )
}
```

### Modified Files

1. **`src/components/Login.tsx`**
   - Removed all `alert()` calls with Chinese text
   - Replaced with `setError()` calls with English messages
   - Added error display area in logged-in view
   - All error messages now appear in the popup UI instead of browser alerts

### Testing Recommendations

Test the following scenarios to verify proper error display:

1. **No active tab**: Error should appear in UI, not as alert
2. **Unsupported page** (e.g., `chrome://extensions`): Error in UI with supported sites list
3. **Article processing incomplete**: Error in UI explaining possible reasons
4. **Content script injection failure**: Error in UI with permission information
5. **Generic errors**: Error in UI with appropriate message

### Code Review Checklist

When adding new user-facing messages:

- [ ] Is the message in English?
- [ ] Is the message displayed in the UI (not as an alert)?
- [ ] Is the message clear and helpful?
- [ ] Does it follow the project's language requirements?
- [ ] Are console logs in English?
- [ ] Are comments in English?

### Exception: Test Data

Chinese text is acceptable in the following contexts:

1. **Test files**: Translation data in `*.test.ts` files
   - Example: `Chinese: '测试'` in word highlighting tests
   - These are test data representing actual translation content

2. **Mock data**: Sample translations for testing purposes

### Verification

To verify language compliance:

```bash
# Search for Chinese characters in source code (excluding test files)
grep -r '[\u4e00-\u9fa5]' src --exclude-dir=__tests__ --include="*.ts" --include="*.tsx"

# Should return no results (except for test data)
```

## Future Guidelines

1. **Always use English** for:
   - User-facing messages
   - Error messages
   - Console logs
   - Comments
   - Documentation
   - Configuration files

2. **Prefer UI messages over alerts**:
   - Use `setError()` for error messages
   - Use status indicators for success states
   - Only use alerts for critical warnings that require immediate attention

3. **Keep messages concise**:
   - Extension popups have limited space
   - Clear and brief is better than verbose

4. **Provide context**:
   - Explain what went wrong
   - Suggest how to fix it (if applicable)
   - Link to console logs for debugging

## References

- Project language requirements: `/AGENTS.md` line 126
- Error handling pattern: `src/components/Login.tsx`
- Error display component: Red border div with text
