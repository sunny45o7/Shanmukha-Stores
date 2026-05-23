---
name: web-maintenance-agent-prompt
description: "Structured prompt for the web-maintenance-agent focused on incident triage and bug hardening."
applyTo: ["**/*"]
---

# Web Maintenance Agent Prompt

Use this template to ask the web-maintenance agent to act as a full-stack protector and maintainer.

## Format

1. root task (short): fix crash, harden security, audit performance, add monitoring
2. scope (files/endpoints/subsystems): routes/auth/cart/orders/checkout
3. failure mode or objective: e.g. "payment timeout", "unhandled async rejection", "path traversal", "rate-limit bypass"
4. deliverables: e.g. "patch + validation + log", "audit report + code changes", "tests + documentation"

## Example
"Use web-maintenance-agent: fix checkout timeout on PayPal API failure in `routes/orderRoutes.js` and `utils/mailer.js`; add retry+circuit-breaker, better user message, and missing test case."
