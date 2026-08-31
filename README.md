# SableStone Brokerage

The autonomous polymer commission-brokerage release described by
[`PRODUCT.md`](PRODUCT.md) and root Plan 66. This project is intentionally
separate from `B2B/sablestone-duty`, which is a customs-duty recovery product.

## Local verification

```bash
python3 -m pytest -q tests/acceptance/plan66
npm run check
```

All live capabilities start disabled. Local and acceptance runs use fixtures
and injected fake providers; they never send outreach or move money.
