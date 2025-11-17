---
layout: default
title: "Black Friday Deals 2025"
description: "README-driven deal explorer with instant search and filters."
---

<div class="page">
  <header class="hero">
    <div class="hero__meta">
      <p class="hero__eyebrow">Community-maintained</p>
      <p class="hero__status" id="lastUpdated">Loading deals…</p>
    </div>
    <h1>💰 Black Friday Deals 2025</h1>
    <p class="hero__lede">
      Automatically generated from the repository <code>README.md</code> so it
      stays in sync with the single source of truth.
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
      Built with GitHub Pages, Actions, and Jekyll. Every push to
      <code>master</code> rebuilds this site from <code>README.md</code>.
    </p>
    <p>
      Want to contribute a deal? Open a pull request on
      <a id="repoLink" href="https://github.com" target="_blank" rel="noopener"
        >GitHub</a
      >.
    </p>
  </footer>
</div>
