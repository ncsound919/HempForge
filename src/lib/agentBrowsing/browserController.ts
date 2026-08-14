export interface BrowserControllerConfig {
  headless?: boolean
  proxy?: { server: string; username?: string; password?: string }
  viewport?: { width: number; height: number }
  userAgent?: string
  recordVideo?: boolean
}

const DEFAULT_CONFIG: BrowserControllerConfig = {
  headless: true,
  viewport: { width: 1280, height: 720 },
}

let browserInstance: unknown = null
let activeContext: unknown = null
let activePage: unknown = null

export async function launchBrowser(config: BrowserControllerConfig = {}): Promise<void> {
  const opts = { ...DEFAULT_CONFIG, ...config }

  if (browserInstance) {
    await closeBrowser()
  }

  try {
    const { chromium } = await import("playwright")
    browserInstance = await chromium.launch({
      headless: opts.headless,
      proxy: opts.proxy ? { server: opts.proxy.server, username: opts.proxy.username, password: opts.proxy.password } : undefined,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        `--window-size=${opts.viewport?.width || 1280},${opts.viewport?.height || 720}`,
      ],
    })
    const ctx = await (browserInstance as any).newContext({
      viewport: opts.viewport,
      userAgent: opts.userAgent,
      recordVideo: opts.recordVideo ? { dir: "./recordings" } : undefined,
    })
    activeContext = ctx
    activePage = await ctx.newPage()
  } catch (err) {
    throw new Error("Browser controller unavailable: playwright not installed")
  }
}

export async function navigate(url: string, waitUntil: "load" | "domcontentloaded" | "networkidle" = "networkidle"): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).goto(url, { waitUntil, timeout: 30000 })
}

export async function click(selector: string): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).click(selector, { timeout: 10000 })
}

export async function clickByText(text: string): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).getByText(text).first().click({ timeout: 10000 })
}

export async function fill(selector: string, value: string): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).fill(selector, value, { timeout: 10000 })
}

export async function getPageContent(): Promise<string> {
  if (!activePage) throw new Error("Browser not launched")
  return (activePage as any).content()
}

export async function getVisibleText(): Promise<string> {
  if (!activePage) throw new Error("Browser not launched")
  return (activePage as any).innerText("body")
}

export async function takeScreenshot(): Promise<Buffer> {
  if (!activePage) throw new Error("Browser not launched")
  return (activePage as any).screenshot({ type: "png", fullPage: false })
}

export async function takeScreenshotBase64(): Promise<string> {
  const buf = await takeScreenshot()
  return buf.toString("base64")
}

export async function pressKey(key: string): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).keyboard.press(key)
}

export async function type(text: string): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).keyboard.type(text)
}

export async function waitForTimeout(ms: number): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).waitForTimeout(ms)
}

export async function waitForSelector(selector: string, timeout = 10000): Promise<void> {
  if (!activePage) throw new Error("Browser not launched")
  await (activePage as any).waitForSelector(selector, { timeout })
}

export async function evaluate<T>(fn: (() => T) | string): Promise<T> {
  if (!activePage) throw new Error("Browser not launched")
  return (activePage as any).evaluate(fn as any)
}

export async function setCookie(name: string, value: string, domain: string): Promise<void> {
  if (!activeContext) throw new Error("Browser not launched")
  await (activeContext as any).addCookies([{ name, value, domain }])
}

export async function closeBrowser(): Promise<void> {
  if (activePage) { try { await (activePage as any).close() } catch {} }
  if (activeContext) { try { await (activeContext as any).close() } catch {} }
  if (browserInstance) { try { await (browserInstance as any).close() } catch {} }
  activePage = null
  activeContext = null
  browserInstance = null
}

export function isBrowserRunning(): boolean {
  return browserInstance !== null && activePage !== null
}
