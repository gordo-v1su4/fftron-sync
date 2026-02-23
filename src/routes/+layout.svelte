<slot />

<style>
  :global(:root) {
    --bg-0: #050505;
    --bg-1: #090909;
    --surface-0: #0f0f10;
    --surface-1: #141415;
    --surface-2: #1b1b1d;
    --border: #2d2d31;
    --text: #f4f4f5;
    --muted: #a1a1aa;
    --accent: #f59e0b;
    --accent-strong: #fbbf24;
    --accent-ok: #10b981;
  }

  :global(html, body) {
    margin: 0;
    min-height: 100%;
    font-family: "Avenir Next", "SF Pro Display", "Segoe UI", sans-serif;
    color: var(--text);
    font-size: 13px;
    line-height: 1.35;
    background:
      radial-gradient(circle at 22% 12%, rgba(245, 158, 11, 0.08) 0%, transparent 34%),
      radial-gradient(circle at 82% 88%, rgba(16, 185, 129, 0.06) 0%, transparent 30%),
      linear-gradient(180deg, var(--bg-1) 0%, var(--bg-0) 100%);
  }

  :global(*) {
    box-sizing: border-box;
  }
</style>
