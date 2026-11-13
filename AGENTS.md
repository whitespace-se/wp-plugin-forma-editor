# Forma Editor

For every UI change, first inspect the equivalent interface in the installed
WordPress core. Reuse its classes, components, icons, wording and interaction
patterns. The Customizer is the visual reference for the editor panel and
publishing controls; the classic editor is the reference for editing locks. Use
native HTML behavior where it fits, retaining WordPress appearance and user
color schemes. Include only controls for implemented content-editing features.

Integration tests run only on local/development installations. Remove generated
users from the entire multisite network, then verify their absence; removing
site membership is not sufficient. Also verify removal of temporary posts.
