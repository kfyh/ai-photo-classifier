AI Photo Classifier

I currently classify photos like so:
Reject - clearly unintentional, fully black frames, motion blur, massive over exposure
Pick - Photos from a folder I want to work on a share
0 - Same as "Reject", unusable photos
1 - Photo may have had some merit but is blurry, out of focus or lacking in some way
2 - Photo is boring
3 - Photo might be good for stock
4 - I really like the photo worth developing further
5 - Massive keeper maybe once in a lifetime shot. Porfolio piece

While I classify and rate things like so, there's a bit of subconcious subjectivity in the classification.

I want to build an app that displays like the lightroom, darktable grid veiw (with loupe and compare modes). And has the categorisation feature.

The main thing the app needs to do is learn my preferences through ML Transfer Learning and suggest classifications (pick, reject) and ratings (0-5) for new and unclassified photos.

As I confirm and classify more photos, I want the app to really learn my preferences and I want stats about how well the suggestions match what I rate over time.