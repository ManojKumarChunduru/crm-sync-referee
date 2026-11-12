# Every target runs offline. The only sockets any target opens are loopback
# sockets to the mock external system, in the tests and in the demo.
# `make verify` is the one promise the README makes.

.PHONY: install lint test coverage experiments receipts evidence mock verify clean

install:
	npm install --no-audit --no-fund

lint:
	npx eslint .

test:
	node --test --test-reporter=spec test/*.test.js

coverage:
	npx c8 --reporter=json-summary --reporter=text --reports-dir=coverage \
	  node --test --test-reporter=junit --test-reporter-destination=docs/test-results.xml test/*.test.js

experiments:
	node experiments/exp01_diff_census.js
	node experiments/exp02_attribution.js
	node experiments/exp03_window_and_skew.js
	node experiments/exp04_timestamp_baseline.js

receipts: coverage experiments
	node tools/collect_metrics.js
	node tools/check_numbers.js

evidence:
	node tools/render_architecture.js
	node tools/capture_screenshots.js
	node tools/record_demo.js

mock:
	node mock/server.js --port 8089

verify: lint receipts

clean:
	rm -rf coverage docs/test-results.xml
