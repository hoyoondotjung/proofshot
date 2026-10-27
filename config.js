/* Public configuration only. Empty string means the same-origin /p proof store.
   Run python3 server.py for the local store. Static hosting alone cannot publish
   links; captures and downloaded originals still work without a store.
   A production store must implement the documented API and retention controls. */
window.PS_API = '';
