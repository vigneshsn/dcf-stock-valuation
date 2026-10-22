import {Component} from "@angular/core";

@Component({
    templateUrl: './feedback.html',
    standalone: true,
    styles: [`
        .feedback { padding-top: 32px; }
        .form-card { padding: 8px; overflow: hidden; background: #fff; }
        iframe { display: block; width: 100%; max-width: 760px; margin: 0 auto; border: 0; }
    `]
})
export class FeedbackComponent {

}
