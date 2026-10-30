#lang racket/base
(require rackunit racket/file json "publy-cli-prototype.rkt")

(define missing (make-temporary-file "publy-probe-missing-~a.json"))
(delete-file missing)
(check-equal? (hash-ref (inspect-config missing) 'reason) "config-not-found")

(define example (make-temporary-file "publy-probe-config-~a.json"))
(call-with-output-file example
  (lambda (out)
    (write-json (hash 'server "https://synthetic.example.test"
                      'api_key "synthetic-do-not-log"
                      'accounts (list (hash 'name "one") (hash 'name "two"))) out))
  #:exists 'truncate)
(define result (inspect-config example))
(check-true (hash-ref result 'ok))
(check-true (hash-ref result 'serverConfigured))
(check-true (hash-ref result 'apiKeyConfigured))
(check-equal? (hash-ref result 'accountCount) 2)
(check-false (regexp-match? #rx"synthetic-do-not-log" (jsexpr->string result)))
(delete-file example)

(define invalid (make-temporary-file "publy-probe-invalid-~a.json"))
(call-with-output-file invalid
  (lambda (out) (display "{ broken json with secret=synthetic-do-not-log" out))
  #:exists 'truncate)
(define invalid-result (inspect-config invalid))
(check-false (hash-ref invalid-result 'ok))
(check-equal? (hash-ref invalid-result 'reason) "invalid-config")
(check-false (regexp-match? #rx"synthetic-do-not-log"
                            (jsexpr->string invalid-result)))
(delete-file invalid)
