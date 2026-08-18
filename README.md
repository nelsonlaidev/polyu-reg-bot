# PolyU eStudent Subject Registration Helper

A Tampermonkey userscript that drops and adds subjects, proceeds to Preview, verifies the result, and stops before **Confirm**.

## Installation

1. Install [Tampermonkey](https://www.tampermonkey.net/) in Chrome.
2. Open the Tampermonkey dashboard and create a new userscript.
3. Replace its contents with [`polyu-subject-registration-helper.user.js`](./polyu-subject-registration-helper.user.js).
4. Save the userscript.
5. Sign in to PolyU eStudent and open Mock Subject Registration or Subject Registration.

On the live registration entry page, select the academic year and semester and click **Go** manually. The helper appears on the following subject-selection page.

Test your complete plan in **MOCK MODE** before using **LIVE MODE**.

## Input format

### Drop subjects

Enter one subject code per line:

```text
COMP0001
COMP0002
```

### Add subjects by component

Enter one subject per line in this format:

```text
SUBJECT | SUBJECT_GROUP | COMPONENT[, COMPONENT]
```

Examples:

```text
COMP0001 | 1001 | LTL001
COMP0002 | 1002 | LEC001, TUT001
```

Replace these examples with codes shown in your own eStudent page.

- `SUBJECT` is the exact subject code.
- `SUBJECT_GROUP` is the number at the start of the dropdown option, such as `1001` in `1001(15)`.
- `COMPONENT` is the exact component code.
- Separate multiple components with commas.

To change a subject's group or component, put the same subject in both fields:

```text
Drop:
COMP0001

Add:
COMP0001 | 1001 | LTL001
```

## How to use

1. Confirm that the panel shows the correct **MOCK MODE** or **LIVE MODE** label.
2. Enter the subjects to drop and add.
3. Click **Run plan**.
4. Review the summary and approve it only if every code is correct.
5. Wait while the helper drops subjects, adds subjects, and opens Preview.
6. Check the Preview verification result:
   - Dropped and added again: `To Change GROUP/COMPONENT`
   - Dropped only: `TO DROP`
   - Added only: `TO ADD`
7. Independently review every Preview row, subject group, and component.
8. Click **Confirm** yourself only if everything is correct. Otherwise, click **Modify**.

The helper never clicks **Confirm**.

### Controls

- **Stop** prevents the next automated step but does not undo completed changes.
- **Reset state** clears saved progress without changing the current shopping cart or input text.

The input plan and running progress are stored locally by Tampermonkey under:

```text
polyu-registration-helper-plan-v1
polyu-registration-helper-state-v1
```

## Disclaimer

This is an unofficial, independent tool and is not affiliated with, endorsed by, or supported by The Hong Kong Polytechnic University.

Use it at your own risk. The script may fail because of website changes, network issues, session expiry, unexpected page state, or incorrect input. It does not guarantee successful registration, seat availability, waitlist placement, or correctness of the final submission.

You are responsible for checking the academic year, semester, subjects, groups, components, Preview result, and all university rules before manually clicking **Confirm**. The authors and contributors are not liable for registration errors, dropped subjects, missed places, data loss, or any other direct or indirect loss arising from use of this script.
