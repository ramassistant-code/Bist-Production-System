---
name: Invoice4U clearing status
description: Correct endpoint and body for verifying a payment after clearing
---
Payment verification after clearing must call `POST https://api.invoice4u.co.il/Services/ApiService.svc/GetClearingLogById` with body `{ "clearingLogId": <int>, "token": "<INVOICE4U_API_KEY>" }`.

**Why:** The endpoint `GetClearingLogByI4UClearingLogId` does not exist (returns HTML 404 "Endpoint not found"), which made the payment page show "טרם זוהה תשלום" even for successful charges. Official docs: invoice4u.gitbook.io → Clearing Payments → Clearing Logs.

**How to apply:** Response is WCF-wrapped in `d` and contains a ClearingLog (`IsSuccess`, `Amount`, `PaymentId`). `clearingLogId` = the `I4UClearingLogId` value from createPaymentLink's OpenInfo. Field names in the body are camelCase (`clearingLogId`, `token`), not PascalCase.
