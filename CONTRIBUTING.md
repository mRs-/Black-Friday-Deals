# Contributing deals for 2026

Thank you for sharing a Black Friday or Cyber Monday deal! Every deal is one small file in `deals/2026/`. The tables in `README.md` and the [website](https://blackfriday.mariuslandwehr.com) are built from those files after each merge, so you never edit `README.md` yourself.

## The easy way: use the form

1. Open [blackfriday.mariuslandwehr.com/submit](https://blackfriday.mariuslandwehr.com/submit/) and fill in your deal.
2. The form opens GitHub with your deal file already filled in. Click **Commit changes**, then **Create pull request**.

You need a GitHub account and nothing else.

## By hand: add one file

Create one file per deal at `deals/2026/<category>/<your-app>.yml`.

- `<category>` is one of the [category folders](#categories), for example `utility-software`.
- The file name uses lowercase letters, numbers and dashes and ends in `.yml`, for example `my-app.yml`.
- On GitHub you can [start the file in your browser](https://github.com/mRs-/Black-Friday-Deals/new/master?filename=deals/2026/CATEGORY/your-app.yml): replace `CATEGORY` and `your-app` in the name box, paste the example below, then commit and open the pull request.

Copy this example and replace every value. It is not a real deal.

```yaml
# Put every text value in double quotes. Lines that start with # are comments.

# Required
name: "Example App"
url: "https://example.com/black-friday"
description: "Short description of what the app does."
discount: "50% off the first year"

# Optional: delete the lines you do not need
percent: 50
code: "EXAMPLE2026"
terms: "annual plan only; new customers"
starts: "2026-11-27"
ends: "2026-11-30"
```

That file becomes this row:

|  | Name | Offer |
| :-: | --- | --- |
| 💸 | **[Example App](https://example.com/black-friday)**<br>Short description of what the app does. | <b>50% off the first year</b><br>`EXAMPLE2026` · annual plan only; new customers · Nov&nbsp;27&nbsp;–&nbsp;Nov&nbsp;30 |

## Fields

| Field | Required | What to write |
| --- | --- | --- |
| `name` | yes | The product name as plain text, up to 60 characters. |
| `url` | yes | Your sale or product page, starting with `https://`. |
| `description` | yes | What the product does, in a sentence or two. Up to 250 characters. |
| `discount` | yes | The offer, for example `"40% off all plans"` or `"Lifetime licence $57 → $35"`. Up to 150 characters. |
| `percent` | no | The percentage as a plain number from 1 to 100, without quotes or `%`. It sets the savings symbol: 💰 below 50, 💸 for 50 or more. Leave it out for a fixed price; the row then shows `—`. |
| `code` | no | The coupon code alone, for example `"BF2026"`. Leave it out when the discount is automatic or there are several codes, and explain that in `terms`. |
| `terms` | no | Conditions and how to redeem: eligible plans, renewal price, "automatically applied". Up to 250 characters. |
| `starts`, `ends` | no | Dates as `"YYYY-MM-DD"`. You can give both, one or neither. For anything else, such as a time of day, write it in `terms`. |

`description`, `discount` and `terms` may use Markdown links, `**bold**`, `~~strikethrough~~` and `` `code` ``. HTML and line breaks are not allowed. Do not add an `added` line: the order comes from the time your pull request is merged.

## House rules

- Only offers for the 2026 season. Do not carry over last year's coupon without checking it.
- One deal per product, in the single most relevant category.
- First come, first served: deals are listed in the order they were merged.
- State the discount and the code, or say that it is applied automatically. No sale-page proof or checkout verification is required.
- To change or remove your deal later, edit or delete your file in a new pull request.

## What the checks look at

Every pull request is checked automatically:

- the file is in an existing category folder and its name follows the rule above;
- `name`, `url`, `description` and `discount` are filled in, and there are no misspelled or unknown fields;
- `url` is a web address, `percent` is a whole number from 1 to 100, dates are real `YYYY-MM-DD` dates and `starts` is not after `ends`;
- text is on one line, has no HTML and stays within the length limits;
- the same product (same name and page) is not listed twice;
- the generated tables in `README.md` are untouched.

If a check fails, click **Details** next to it. The message names the file, the line and the fix. Edit the file in your pull request (pencil icon), commit, and the checks run again. On your first pull request the checks start once a maintainer has approved them.

## Categories

| Category | Folder |
| --- | --- |
| 🛠 Development Software | `deals/2026/development-software/` |
| 🤖 AI Tools | `deals/2026/ai-tools/` |
| 🌈 Marketing Software | `deals/2026/marketing-software/` |
| 🎩 Security Software | `deals/2026/security-software/` |
| 🎛 Utility Software | `deals/2026/utility-software/` |
| 📌 Productivity Software | `deals/2026/productivity-software/` |
| 🎥 Video Software | `deals/2026/video-software/` |
| 🎨 Graphic Software | `deals/2026/graphic-software/` |
| 🏝️ Lifestyle | `deals/2026/lifestyle/` |
| 🗣️ Social | `deals/2026/social/` |
| 🎓 Reference & Education | `deals/2026/reference-education/` |
| 📖 Books | `deals/2026/books/` |
| 👩‍🎓 Courses and Videos | `deals/2026/courses-and-videos/` |
| 📈 Business Software | `deals/2026/business-software/` |
| 🏃🏻‍♀️ Health & Fitness Software | `deals/2026/health-fitness-software/` |
| 🎁 Bundles | `deals/2026/bundles/` |
| 🎶 Creative Content | `deals/2026/creative-content/` |
| 🤑 Finance | `deals/2026/finance/` |
| 🗺️ Navigation | `deals/2026/navigation/` |
| 🔎 SEO | `deals/2026/seo/` |
| 🏡 Home Automation | `deals/2026/home-automation/` |
| 🕹 Games | `deals/2026/games/` |

A folder that has no deals yet does not exist on GitHub. It is created when you add the first file to it.

## Maintainers

Node.js 22 or later. `npm ci` once, then:

| Command | What it does |
| --- | --- |
| `npm run validate` | Checks `deals/categories.yml` and every deal file; prints every problem with its fix. |
| `npm test` | Runs the tests for the scripts and the site. |
| `npm run build:readme` | Rebuilds the part of `README.md` between `DEALS:START` and `DEALS:END`. `node scripts/build-readme.mjs --check` only reports whether it is stale. |
| `npm run build:site` | Builds the website into `_site/`. |

After every push to `master` the **Publish README and website** workflow validates the deals, commits `README.md` as `Regenerate README` if it changed, and deploys the site. It pushes to `master` with the workflow token, so `master` must not get a branch protection rule or ruleset that blocks direct pushes from GitHub Actions. The deal order needs the full git history: use a normal clone, not a shallow one.

Do not merge a pull request whose **Check deals** run is red. If a pull request that edits the README tables gets merged anyway, nothing is lost: the workflow notices that the tables were changed by hand (the `DEALS:END` line carries a checksum), leaves `README.md` alone, fails, and lists the rows together with the commands that turn them into deal files. The website is still deployed.

A pull request that still adds rows to the README tables can be converted:

```sh
git fetch origin pull/1234/head
git show FETCH_HEAD:README.md > /tmp/pr-1234.md
node scripts/import-readme.mjs --from /tmp/pr-1234.md           # report only
node scripts/import-readme.mjs --from /tmp/pr-1234.md --write   # writes deals that are not in deals/ yet
```

The importer never changes existing deal files. It gives each new file an `added` time so the rows keep their order; that is the one case where `added` is set by hand. Categories and their order live in `deals/categories.yml`; `anchor` is the README link target and must stay as it is.
