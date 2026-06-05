# LLM 调用重试机制 - 设计文档

> 为 LLM API 调用添加指数退避重试机制，提升日报生成的可靠性。

**创建日期**: 2026-06-05
**状态**: 设计中

---

## 1. 概述

### 1.1 问题

当前 `generateReport` 中的 LLM API 调用只尝试一次，失败后立即 fallback 到模板生成。遇到网络抖动、服务端临时故障（502/503）、速率限制（429）等可恢复错误时，用户无法获得 LLM 生成的高质量日报。

### 1.2 目标

- 在可恢复错误时自动重试，最大重试次数默认 5 次
- 使用指数退避策略避免加重服务端压力
- 用户可通过配置文件调整重试参数
- 不可恢复的错误（401、400 等）立即 fallback，不浪费重试

### 1.3 非目标

- 不重试非临时性错误（4xx 非 429、JSON 解析失败、空内容）
- 不引入独立的重试模块（当前仅 LLM 调用需要）
- 不改变 template fallback 行为（重试耗尽后仍 fallback）

---

## 2. 设计

### 2.1 类型变更

`LLMConfig` 新增两个可选字段：

```typescript
export interface LLMConfig {
  provider: string;
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries?: number;         // 最大重试次数，默认 5
  retryBaseDelayMs?: number;   // 基础延迟 ms，默认 1000
  requestTimeoutMs?: number;   // 单次请求超时 ms，默认 30000
}
```

默认值：
```typescript
maxRetries: 5,
retryBaseDelayMs: 1000,
requestTimeoutMs: 30000,
```

### 2.2 重试判定

| 错误类型 | 是否重试 | 理由 |
|----------|----------|------|
| 网络错误（fetch 底层异常） | ✅ | 临时网络问题 |
| HTTP 5xx (500-599) | ✅ | 服务端临时故障 |
| HTTP 429 | ✅ | 速率限制，等待后可用 |
| 超时 (AbortError) | ✅ | 可能服务端负载高 |
| HTTP 4xx 非 429 (400, 401, 403...) | ❌ | 客户端错误，重试无意义 |
| 空内容（200 但无 content） | ❌ | 模型行为问题，重试大概率同样 |
| JSON 解析失败 | ❌ | 响应格式异常，重试大概率同样 |

### 2.3 指数退避

- 公式：`delay = min(baseDelayMs * 2^(attempt-1), 30000)`
- 默认 baseDelayMs = 1000ms
- 实际等待序列：1s → 2s → 4s → 8s → 16s
- 每次重试独立超时，由 `requestTimeoutMs` 控制（默认 30s）

### 2.4 核心函数

```
shouldRetry(error): boolean     — 判断错误是否可重试
sleep(ms): Promise<void>        — 异步等待
retryWithBackoff(fn, config): Promise<T> — 带退避的重试执行器
```

### 2.5 generateReport 改造

**Before**: `try { fetch } catch { templateFallback }`
**After**: `try { retryWithBackoff(fetch) } catch { templateFallback }`

行为不变：
- 不可重试错误立即进入 catch，fallback 到模板
- 重试耗尽后进入 catch，fallback 到模板
- 无 API key 时仍然直接模板

### 2.6 CLI 参数

新增 `--max-retries <number>` 选项，覆盖配置文件值。

---

## 3. 文件变更清单

| 文件 | 变更 |
|------|------|
| `src/types.ts` | LLMConfig 添加 maxRetries、retryBaseDelayMs、requestTimeoutMs |
| `src/config.ts` | 默认配置添加重试字段 |
| `src/generator.ts` | 添加 shouldRetry、sleep、retryWithBackoff；改造 generateReport |
| `src/index.ts` | 添加 --max-retries CLI 选项 |
| `tests/generator.test.ts` | 添加 retry 相关测试用例 |

---

## 4. 测试策略

- `shouldRetry`: 各错误类型的分类正确性
- `retryWithBackoff`: 成功不重试、重试指定次数后成功、重试耗尽后失败、不可重试错误立即失败
- `generateReport`: 重试后成功返回 LLM 结果、重试耗尽后 fallback 模板、不可重试错误立即 fallback
- 退避延迟验证：通过 mock 计时确认延迟序列正确
