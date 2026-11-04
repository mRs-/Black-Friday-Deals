# Contributing deals for 2026

Thank you for sharing a Black Friday or Cyber Monday deal! Submit a pull request against `master` that edits `README.md`; the website reads its deals from that file.

1. Confirm that the offer is valid for the 2026 season. Do not carry over a previous year's coupon without checking it.
2. Choose the single most relevant existing category. Keep empty categories and their table headers in place.
3. Add one row at the bottom of the category. Entries are first come, first served; keep existing rows in place and check for duplicates.
4. Use the five-column format below. Keep the description short; put eligibility, plan restrictions, and renewal terms in **Code & Terms**.
5. Include the product URL, discount, and code or redemption method. Dates are optional; if you provide them, put them in **Code & Terms**.
6. State the discount and code (or say it is automatic). No sale-page proof or checkout verification is required.

## Row template

Copy only the example row into the appropriate table and replace every example value with your offer. The example is not a real deal.

```markdown
| Savings | Name | Description | Discount | Code & Terms |
| --- | --- | --- | --- | --- |
| 💸 | [Example App](https://example.com) | Short description of the app. | 50% off | **EXAMPLE2026**; annual plan, first year only; 2026-11-27 to 2026-11-30 |
```

Use 💰 for discounts below 50%, 💸 for 50% or more, and `—` when a percentage does not apply. For automatic discounts, write `Automatically applied` in **Code & Terms**. Use `&#124;` if a cell needs a literal pipe so it does not create an extra column.

## Keep merges small

- Keep each deal on one physical line, with one space around each `|` separator.
- Do not pad cells to align column widths or run a table formatter over the README.
- Change only your deal's row. Do not sort whole tables or rewrite neighboring entries.
- Update your branch from `master` before submitting and after conflicting PRs merge. Keep your new row below all existing offers when resolving conflicts.
- Keep examples in this guide, outside the live deal tables.

## Website changes

For changes to the README parser or filtering behavior, run `npm test` (Node.js 22 or later). To build the site locally, run `bundle install` and `PAGES_REPO_NWO=mRs-/Black-Friday-Deals bundle exec jekyll build --destination ../_site` from `docs/`. The environment variable identifies the repository for GitHub metadata during local builds.
