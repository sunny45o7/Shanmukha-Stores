document.addEventListener('DOMContentLoaded', function () {
    const selects = document.querySelectorAll('select.filter-select, select.dash-filter-select, select.glass, form[method="GET"] select');

    selects.forEach(function (select) {
        // Create wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'custom-select-wrapper';
        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);

        // Hide original select
        select.style.display = 'none';

        // Create trigger
        const trigger = document.createElement('div');
        trigger.className = 'custom-select-trigger';
        
        // Find selected option text
        let selectedText = select.options[select.selectedIndex]?.text || 'Select...';
        trigger.innerHTML = `<span>${selectedText}</span><div class="arrow"></div>`;
        wrapper.appendChild(trigger);

        // Create options container
        const optionsContainer = document.createElement('div');
        optionsContainer.className = 'custom-options';
        
        // Populate options
        Array.from(select.options).forEach(function (option) {
            const customOption = document.createElement('div');
            customOption.className = 'custom-option' + (option.selected ? ' selected' : '');
            customOption.textContent = option.text;
            customOption.dataset.value = option.value;
            
            customOption.addEventListener('click', function (e) {
                // Update original select
                select.value = this.dataset.value;
                
                // Update trigger text
                trigger.querySelector('span').textContent = this.textContent;
                
                // Update selected class
                optionsContainer.querySelectorAll('.custom-option').forEach(opt => opt.classList.remove('selected'));
                this.classList.add('selected');
                
                // Close dropdown
                wrapper.classList.remove('open');
                
                // Trigger change event on original select
                const event = new Event('change', { bubbles: true });
                select.dispatchEvent(event);
            });
            
            optionsContainer.appendChild(customOption);
        });
        
        wrapper.appendChild(optionsContainer);

        // Toggle dropdown
        trigger.addEventListener('click', function (e) {
            e.stopPropagation();
            // Close other dropdowns
            document.querySelectorAll('.custom-select-wrapper.open').forEach(function(openWrapper) {
                if (openWrapper !== wrapper) openWrapper.classList.remove('open');
            });
            wrapper.classList.toggle('open');
        });
    });

    // Close when clicking outside
    document.addEventListener('click', function () {
        document.querySelectorAll('.custom-select-wrapper').forEach(function (wrapper) {
            wrapper.classList.remove('open');
        });
    });
});
