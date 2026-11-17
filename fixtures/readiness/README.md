# Synthetic readiness test data

These files contain no student information. See FEATURES-AND-TESTS.md for expected results.

- course-outline.html: course page for fresh AI deadline reading.
- course-update.html: contradictory worksheet deadline for confirmation testing.
- course-outline.txt and course-update.txt: readable source copies. Plain text uploads use the Testudo schedule reader, so prefer HTML for deadline tests.
- test-calendar.ics: one-off worksheet event plus a recurring class. Lens imports the one-off event and explicitly skips the repeating event; this fixture tests that limitation.
- intentionally-invalid.docx: deliberately invalid archive for a conversion-error test.
- make-room-request.json: fixed-clock developer fixture for advanced planning, preserving its original dates.

Fresh AI reading requires a configured reader key. Native calendar parsing does not. Do not shift source dates and continue calling them verified by the original source.
