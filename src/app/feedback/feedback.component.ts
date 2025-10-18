import {Component} from "@angular/core";
import {MatButton} from "@angular/material/button";
import {RouterLink} from "@angular/router";

@Component({
    templateUrl: './feedback.html',
    standalone: true,
    imports: [
        MatButton,
        RouterLink
    ]
})
export class FeedbackComponent {

}