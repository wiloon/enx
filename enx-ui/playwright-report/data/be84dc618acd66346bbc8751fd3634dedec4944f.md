# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e3]:
    - generic [ref=e5]: Create Account
    - generic [ref=e6]:
      - generic [ref=e7]:
        - generic [ref=e8]:
          - generic [ref=e9]: Username
          - textbox "Username" [ref=e10]:
            - /placeholder: Choose a username
        - generic [ref=e11]:
          - generic [ref=e12]: Email
          - textbox "Email" [active] [ref=e13]:
            - /placeholder: Enter your email
            - text: not-an-email
        - generic [ref=e14]:
          - generic [ref=e15]: Password
          - textbox "Password" [ref=e16]:
            - /placeholder: Choose a password
        - button "Create Account" [ref=e17]
      - button "Already have an account? Login" [ref=e19]
  - button "Open Next.js Dev Tools" [ref=e25] [cursor=pointer]:
    - img [ref=e26]
  - alert [ref=e29]
```