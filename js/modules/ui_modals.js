/**
 * ui_modals.js - Custom Action Modal logic
 */

export const UI_MODAL = {
    modal: null,
    title: null,
    body: null,
    input: null,
    confirmBtn: null,
    cancelBtn: null,
    resolve: null,

    init() {
        this.modal = document.getElementById('actionModal');
        this.title = document.getElementById('actionModalTitle');
        this.body = document.getElementById('actionModalBody');
        this.input = document.getElementById('actionModalInput');
        this.confirmBtn = document.getElementById('actionConfirmBtn');
        this.cancelBtn = document.getElementById('actionCancelBtn');

        this.confirmBtn?.addEventListener('click', () => this.handleAction(true));
        this.cancelBtn?.addEventListener('click', () => this.handleAction(false));
    },

    show({ title, message, useInput = false, placeholder = '', confirmText = 'Confirm', cancelText = 'Cancel', defaultValue = '' }) {
        if (!this.modal) this.init();

        this.title.textContent = title;
        this.body.textContent = message;
        this.confirmBtn.textContent = confirmText;
        this.cancelBtn.textContent = cancelText;

        if (useInput) {
            this.input.style.display = 'block';
            this.input.placeholder = placeholder;
            this.input.value = defaultValue;
        } else {
            this.input.style.display = 'none';
        }

        this.modal.classList.add('active');
        this.input.focus();

        return new Promise((resolve) => {
            this.resolve = resolve;
        });
    },

    handleAction(confirmed) {
        this.modal.classList.remove('active');
        if (this.resolve) {
            const isInput = this.input.style.display === 'block';
            if (confirmed) {
                const value = isInput ? this.input.value : true;
                this.resolve(value);
            } else {
                // If it was a prompt, return null on cancel.
                // If it was a confirm, return false on cancel.
                this.resolve(isInput ? null : false);
            }
            this.resolve = null;
        }
    },

    // Shortcuts
    async confirm(title, message, confirmText = 'Yes', cancelText = 'No') {
        return await this.show({ title, message, confirmText, cancelText });
    },

    async prompt(title, message, placeholder = '', defaultValue = '') {
        return await this.show({ title, message, useInput: true, placeholder, defaultValue });
    },

    async alert(title, message) {
        return await this.show({ title, message, cancelText: 'Close', confirmText: 'OK' });
    }
};
