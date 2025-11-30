<template>
  <div
    v-on:dragover.prevent="onDragOver"
    v-on:dragleave="onDragLeave"
    v-on:drop.prevent="onDrop"
    v-bind="$attrs"
  >
    <slot :dragHover="dragHover" />
  </div>
</template>

<script>
async function readAllDirEntries(dirEntry) {
  const reader = dirEntry.createReader();
  const allEntries = [];
  let entries = [];
  do {
    entries = await new Promise((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    allEntries.push(...entries);
  } while (entries.length);
  return allEntries;
}

async function entryToFile(fileEntry) {
  return new Promise((resolve, reject) => {
    fileEntry.file(resolve, reject);
  });
}

async function readAllFiles(entries) {
  const toProcess = [...entries];
  const fileEntries = [];
  while (toProcess.length) {
    const entry = toProcess.shift();
    if (entry.isFile) {
      fileEntries.push(entry);
    } else {
      toProcess.push(...(await readAllDirEntries(entry)));
    }
  }
  return Promise.all(fileEntries.map(entryToFile));
}

export default {
  name: 'DragAndDrop',
  props: {
    enabled: Boolean,
  },
  data() {
    return {
      dragHover: false,
    };
  },
  methods: {
    onDragOver(ev) {
      if (this.enabled) {
        ev.preventDefault();

        const { types } = ev.dataTransfer;
        if (
          types && types instanceof Array
            ? types.indexOf('Files') !== -1
            : 'Files' in types
        ) {
          this.dragHover = true;
          if (this.dragTimeout !== null) {
            window.clearTimeout(this.dragTimeout);
            this.dragTimeout = null;
          }
        }
      }
    },
    onDragLeave() {
      if (this.enabled) {
        this.dragTimeout = window.setTimeout(() => {
          this.dragHover = false;
          this.dragTimeout = null;
        }, 50);
      }
    },
    async onDrop(ev) {
      if (this.enabled) {
        this.dragHover = false;
        if (ev.dataTransfer.items) {
          const entries = [...ev.dataTransfer.items]
            .map((item) => {
              const getAsEntry = item.webkitGetAsEntry || item.getAsEntry;
              return getAsEntry.call(item);
            })
            .filter(Boolean);
          const files = await readAllFiles(entries);
          if (files.length) {
            this.$emit('drop-files', files);
          }
        } else if (ev.dataTransfer.files.length) {
          this.$emit('drop-files', Array.from(ev.dataTransfer.files));
        }
      }
    },
  },
  created() {
    // used to debounce dragover
    this.dragTimeout = null;
  },
};
</script>
