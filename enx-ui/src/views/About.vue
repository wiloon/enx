<template>
  <v-container
    class="fill-height"
    fluid
  >
    <v-row
      align="center"
      justify="center"
    >
      <v-col class="text-center">
        <v-text-field v-model="word"></v-text-field>
      </v-col>
      <v-col>
        <v-btn v-on:click="doSearch">Search</v-btn>
      </v-col>
    </v-row>
  </v-container>
</template>
