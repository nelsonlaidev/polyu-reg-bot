# PolyU eStudent Subject Registration Helper

A Tampermonkey userscript that drops, adds, or changes subjects, proceeds to Preview, verifies the result, and stops before **Confirm**.

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

If eStudent does not provide a trash button for a requested subject, the helper stops before making any changes. Such subjects may require approval or another official process before they can be dropped.

### Add or change subjects by component

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

Use the same format to change the group or components of a subject that is already registered. Do not put that subject in **Drop subjects**:

```text
COMP0001 | 1001 | LTL001
```

The helper automatically reads the shopping cart's registration status to decide whether each line is an addition or a change. A subject listed in both fields is rejected.

## How to use

1. Confirm that the panel shows the correct **MOCK MODE** or **LIVE MODE** label.
2. Enter the subjects to drop, add, or change.
3. Click **Run plan**.
4. Review the summary and approve it only if every code is correct.
5. Wait while the helper applies the plan and opens Preview.
6. Check the Preview verification result:
   - Existing subject changed through Add/Change: `To Change GROUP/COMPONENT`
   - Dropped only: `TO DROP`
   - New subject added: `TO ADD`
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
