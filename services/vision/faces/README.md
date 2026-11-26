# Enrolled faces

One folder per elder (the elder's id from the CareCircle dashboard URL), one sub-folder per person:

```
faces/<elderId>/patient/1.jpg      <- the elder: label must be "patient"
faces/<elderId>/patient/2.jpg
faces/<elderId>/Anita/1.jpg        <- family or carers: the folder name is shown on the dashboard
```

3–5 clear, front-facing photos per person work best. These photos are personal data: they are
git-ignored and never leave this machine. Restart the service (or POST /faces/reload) after changes.
