#lang racket/base

;; Minimal, read-only Racket distribution proof, not the publishing CLI.
;; Uses bundled Racket libraries; never sends network requests or logs secrets.
(require json racket/cmdline racket/file racket/path racket/string)
(provide probe-version inspect-config main)

(define probe-version "0.1.0-prototype")

(define (default-config-path)
  (or (getenv "PUBLY_CONFIG")
      (build-path (find-system-path 'home-dir) ".publy" "config.json")))

(define (present-string? v)
  (and (string? v) (not (string=? (string-trim v) ""))))

(define (inspect-config [source (default-config-path)])
  (cond
    [(not (file-exists? source))
     (hash 'ok #f 'reason "config-not-found"
           'serverConfigured #f 'apiKeyConfigured #f 'accountCount 0)]
    [else
     (with-handlers ([exn:fail?
                      (lambda (_err)
                        ;; Do not echo parse errors: they can include secret-bearing input.
                        (hash 'ok #f 'reason "invalid-config"
                              'serverConfigured #f 'apiKeyConfigured #f
                              'accountCount 0))])
       (define data (call-with-input-file source read-json))
       (unless (hash? data) (error 'inspect-config "expected object"))
       (define accounts (hash-ref data 'accounts #f))
       (hash 'ok #t 'reason "config-loaded"
             'serverConfigured (present-string? (hash-ref data 'server #f))
             'apiKeyConfigured (present-string? (hash-ref data 'api_key #f))
             'accountCount (if (list? accounts) (length accounts) 0)))]))

(define (main)
  (define json-mode? #f)
  (define config-path (default-config-path))
  (define action
    (command-line
     #:program "publy-racket-probe"
     #:once-each
     [("--json") "Print one JSON object without secret values."
                 (set! json-mode? #t)]
     [("--config") file "Use a specific CLI config file for doctor."
                           (set! config-path file)]
     #:args (action)
     action))
  (define result
    (cond
      [(string=? action "version")
       (hash 'ok #t 'kind "prototype" 'version probe-version)]
      [(string=? action "doctor")
       (hash-set (inspect-config config-path) 'kind "prototype")]
      [else
       (fprintf (current-error-port)
                "Unsupported prototype command: ~a (use version or doctor)\n" action)
       (exit 2)]))
  (if json-mode?
      (displayln (jsexpr->string result))
      (if (string=? action "version")
          (printf "Publy Racket distribution prototype ~a (not the publishing CLI)\n"
                  probe-version)
          (printf "Publy config: ~a; server: ~a; key: ~a; accounts: ~a\n"
                  (hash-ref result 'reason)
                  (hash-ref result 'serverConfigured)
                  (hash-ref result 'apiKeyConfigured)
                  (hash-ref result 'accountCount))))
  (unless (hash-ref result 'ok) (exit 3)))

(module+ main (main))
