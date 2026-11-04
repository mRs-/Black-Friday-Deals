---
layout: default
title: "Black Friday Deals 2026"
description: "Explore community-submitted Black Friday and Cyber Monday deals for 2026."
---

<div class="page">
  <header class="hero">
    <div class="hero__meta">
      <p class="hero__eyebrow">Community-maintained</p>
      <p class="hero__status" id="lastUpdated">Loading deals…</p>
    </div>
    <h1>💰 Black Friday Deals 2026</h1>
    <p class="hero__lede">
      Discover community-submitted offers for Black Friday and Cyber Monday 2026.
      Have a deal to share? Choose a category below and contribute on GitHub.
    </p>
    <div class="filters">
      <label class="field">
        <span>Search</span>
        <input
          id="searchInput"
          type="search"
          placeholder="Find a tool, app, or keyword…"
          autocomplete="off"
        />
      </label>
      <label class="field">
        <span>Category</span>
        <select id="categoryFilter">
          <option value="all">All categories</option>
        </select>
      </label>
    </div>
  </header>

  <main>
    <section class="summary" aria-live="polite">
      <div class="summary__item">
        <p class="summary__label">Deals loaded</p>
        <p class="summary__value" id="dealsCount">—</p>
      </div>
      <div class="summary__item">
        <p class="summary__label">Categories</p>
        <p class="summary__value" id="categoryCount">—</p>
      </div>
    </section>

    <section id="results" class="results" aria-live="polite">
      <div class="placeholder">
        <p>Hang tight — we are fetching the latest deals.</p>
      </div>
    </section>
  </main>

  <footer class="site-footer">
    <p>
      Black Friday: November 27, 2026 · Cyber Monday: November 30, 2026.
      Check each offer for its own dates and terms.
    </p>
    <p>
      Want to contribute a deal? Open a pull request on
      <a id="repoLink" href="https://github.com" target="_blank" rel="noopener"
        >GitHub</a
      >.
    </p>
  </footer>
</div>
