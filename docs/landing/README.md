# Landing page source

`index.html` is the maintained source for the product page at
`buildproven.ai/qa-architect`. It is self-contained: it has no build step or
external CDN calls.

The Pro call to action is a launch-list email while paid fulfillment is not
verified. Do not replace it with checkout until provider configuration and a
bounded live lifecycle test prove payment, webhook delivery, signed registry
publication, activation, cancellation, refund, and revocation. Keep
provider-specific product IDs out of this source.
