# Third-party store channels (submit manually; add each one in Admin -> Channels & Mirrors when live)

For EVERY store: upload the same APK you publish on the website, built with the `direct-*` EAS profile for that store so the app reports the right
channel. If a store RE-SIGNS the APK, copy that store's signing-certificate SHA-256 into the channel's "Cert override" field AND into
Update & Integrity Policy -> Official signing certificates, otherwise installs from that store will fail verification (this is the single
most common cause of a failure spike after adding a store).

| Store | Profile | Notes |
|---|---|---|
| Samsung Galaxy Store | `direct-samsung` | Seller account + app review. Check whether you upload your own signature or Samsung re-signs. |
| Huawei AppGallery | `direct-huawei` | AppGallery Connect developer account. Huawei phones often lack Google Play services, so FCM push will not work there (needs HMS Push if you want notifications). |
| Aptoide | `direct` | Create a store or publish to the main one with your developer account. |
| APKPure | `direct` | Developer submission. Third parties can also upload your app without asking: watch Look-alikes & Fakes. |
| Zapstore | `direct` | See distribution/zapstore.yaml. |
| Own F-Droid repo | `direct` | See distribution/fdroid-metadata.yml. |

Each store's own terms and review rules apply. Check them before submitting (content, payments, permissions such as REQUEST_INSTALL_PACKAGES, which some stores restrict).
