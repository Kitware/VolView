<template>
  <v-container class="page-container bg-grey-darken-3" v-bind="$attrs">
    <v-col>
      <v-row justify="center">
        <v-card flat dark color="transparent" class="text-center headline">
          <div>
            <v-icon size="64">mdi-folder-open</v-icon>
          </div>
          <div>Click to open local files.</div>
          <div class="mt-8">
            <v-icon size="64">mdi-arrow-down-bold</v-icon>
          </div>
          <div>Drag &amp; drop your DICOM files.</div>

          <div class="vertical-offset-margin">
            <slot></slot>
          </div>
        </v-card>
      </v-row>
    </v-col>
  </v-container>
</template>

<style scoped>
.page-container {
  flex: 1 1 auto;
  display: flex;
  flex-flow: row;
  align-items: center;
}
</style>
